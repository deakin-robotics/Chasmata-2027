#!/usr/bin/env python3
"""
Chasmata Fake Sensor Publisher  —  v4 (state-machine + width-aware avoidance)
=============================================================================
Simulates LiDAR, IMU, and Wheel Odometry for the autonomy pipeline.

Navigation state machine
------------------------
    NAVIGATE  ──(obstacle < WARN_DIST)──► AVOID
    NAVIGATE  ──(obstacle < EMERG_DIST)─► REVERSE
    NAVIGATE  ──(stuck)─────────────────► REVERSE
    AVOID     ──(clear  again)──────────► NAVIGATE
    AVOID     ──(stuck / emergency)─────► REVERSE
    REVERSE   ──(timer done)────────────► NAVIGATE

Three safety zones (from rover hitbox edge)
------------------
    WARN_DIST   = 1.30 m  → start adjusting heading, slow down
    DANGER_DIST = 0.65 m  → full avoidance; commit to chosen heading ≥ 1 s
    EMERG_DIST  = 0.35 m  → hard stop, immediately enter REVERSE

Width-aware gap detection
-------------------------
  For each candidate direction we cast 3 parallel rays offset by ±ROBOT_RADIUS.
  A gap is only "clear" if ALL three rays exceed DANGER_DIST.
  This prevents the rover from trying to squeeze through passages it can't fit.

Stuck policy
------------
  Track position history over 2 s.
  If total displacement < 0.15 m → declare stuck → enter REVERSE.
  Reverse for 1.5 s (with collision guard backwards too).
  After reversing, pick the widest available gap and commit to it.
"""

import math
import random
from enum import IntEnum
from collections import deque

import rclpy
from rclpy.node import Node

from std_msgs.msg import Empty
from sensor_msgs.msg import LaserScan, Imu
from nav_msgs.msg import Odometry
from geometry_msgs.msg import Quaternion, PoseArray


# ── Robot geometry ────────────────────────────────────────────────────────────
ROBOT_RADIUS = 0.36   # (m) circumscribed circle — body 0.6×0.4 m

# ── Distance zones (measured from the nearest obstacle surface) ───────────────
WARN_DIST    = 1.30   # start adjusting heading
DANGER_DIST  = 0.65   # full avoidance / commit heading
EMERG_DIST   = 0.38   # hard stop + reverse

# ── Gap detection ─────────────────────────────────────────────────────────────
NUM_CAND_DIRS = 36     # candidate headings sampled every 10°
COMMIT_SECS   = 1.0    # seconds to hold an avoidance heading before reconsidering

# ── Speeds ────────────────────────────────────────────────────────────────────
FWD_SPEED    = 0.25   # m/s   normal forward
WARN_SPEED   = 0.15   # m/s   slowed in warn zone
REV_SPEED    = 0.20   # m/s   reverse
TURN_SPEED   = 0.80   # rad/s avoidance / reverse turn
ALIGN_SPEED  = 0.50   # rad/s normal heading correction

# ── Stuck detection ───────────────────────────────────────────────────────────
STUCK_WINDOW     = 2.0    # (s)  observation window
STUCK_MIN_TRAVEL = 0.15   # (m)  minimum displacement to NOT be stuck
REVERSE_SECS     = 1.5    # (s)  how long to reverse before re-planning

# ── Waypoints ─────────────────────────────────────────────────────────────────
WP_REACH     = 0.30   # (m) waypoint considered reached


class State(IntEnum):
    NAVIGATE = 0
    AVOID    = 1
    REVERSE  = 2


def _quat(yaw):
    c, s = math.cos(yaw * 0.5), math.sin(yaw * 0.5)
    q = Quaternion()
    q.w, q.z = c, s
    return q


def _wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


class FakeSensorPublisher(Node):

    def __init__(self):
        super().__init__('chasmata_fake_sensors')

        # Publishers
        self.scan_pub      = self.create_publisher(LaserScan, '/scan',            10)
        self.imu_pub       = self.create_publisher(Imu,       '/imu/data',        10)
        self.odom_pub      = self.create_publisher(Odometry,  '/wheel_odom',      10)
        self.heartbeat_pub = self.create_publisher(Empty,     '/rover/heartbeat', 10)

        # Dynamic obstacles from obstacle_server / interactive markers
        self._dyn_walls: list = []
        self._obs_half = 0.30
        self.create_subscription(PoseArray, '/sim_obstacle_poses',
                                 self._on_obstacles, 10)

        # ── Rover state ───────────────────────────────────────────────────────
        self.x   = 2.0
        self.y   = 2.0
        self.yaw = 0.0
        self.vx  = 0.0
        self.wz  = 0.0

        # State machine
        self.state        = State.NAVIGATE
        self.state_timer  = 0.0   # seconds spent in current state

        # Avoidance — committed heading (no oscillation)
        self._avoid_yaw     = None   # target heading chosen when entering AVOID
        self._avoid_elapsed = 0.0    # time spent on this avoid heading

        # Stuck detection — ring buffer of (timestamp_s, x, y)
        self._pos_buf = deque(maxlen=200)   # 200 × 50ms = 10s max

        # Waypoints — 4 corners of the 3 m square
        self.waypoints = [(5.0, 2.0), (5.0, 5.0), (2.0, 5.0), (2.0, 2.0)]
        self.wp_idx    = 0

        # Static environment: 9 m × 9 m room + fixed 1 m box at (3.5, 3.5)
        self.static_walls = [
            ((-2.0, -2.0), ( 7.0, -2.0)),
            (( 7.0, -2.0), ( 7.0,  7.0)),
            (( 7.0,  7.0), (-2.0,  7.0)),
            ((-2.0,  7.0), (-2.0, -2.0)),
            ((3.0, 3.0), (4.0, 3.0)),
            ((4.0, 3.0), (4.0, 4.0)),
            ((4.0, 4.0), (3.0, 4.0)),
            ((3.0, 4.0), (3.0, 3.0)),
        ]

        self.dt = 0.05
        self.create_timer(self.dt, self.update)
        self.create_timer(0.10,    self.publish_scan)
        self.create_timer(0.01,    self.publish_imu)
        self.create_timer(1.00,    self.publish_heartbeat)

        self.get_logger().info(
            '=== Fake Sensors v4  (state-machine + width-aware gap finding) ==='
        )

    # ── Dynamic obstacle callback ─────────────────────────────────────────────
    def _on_obstacles(self, msg: PoseArray):
        h = self._obs_half
        walls = []
        for p in msg.poses:
            cx, cy = p.position.x, p.position.y
            walls += [
                ((cx-h, cy-h), (cx+h, cy-h)),
                ((cx+h, cy-h), (cx+h, cy+h)),
                ((cx+h, cy+h), (cx-h, cy+h)),
                ((cx-h, cy+h), (cx-h, cy-h)),
            ]
        self._dyn_walls = walls

    # ── Geometry helpers ──────────────────────────────────────────────────────
    def _all_walls(self):
        return self.static_walls + self._dyn_walls

    @staticmethod
    def _pt_seg_sq(px, py, x1, y1, x2, y2):
        dx, dy = x2-x1, y2-y1
        sq = dx*dx + dy*dy
        if sq < 1e-12:
            return (px-x1)**2 + (py-y1)**2
        t  = max(0.0, min(1.0, ((px-x1)*dx + (py-y1)*dy) / sq))
        return (px - x1-t*dx)**2 + (py - y1-t*dy)**2

    def _collides(self, x, y, radius=None):
        r2 = (radius or ROBOT_RADIUS) ** 2
        for (x1,y1),(x2,y2) in self._all_walls():
            if self._pt_seg_sq(x, y, x1, y1, x2, y2) < r2:
                return True
        return False

    # ── Ray casting ───────────────────────────────────────────────────────────
    def _ray(self, world_angle, max_r=15.0):
        """Distance to nearest surface along world_angle (from lidar at +0.2 m)."""
        lo = 0.2
        rx = self.x + lo * math.cos(self.yaw)
        ry = self.y + lo * math.sin(self.yaw)
        dx, dy = math.cos(world_angle), math.sin(world_angle)
        best = max_r
        for (x1,y1),(x2,y2) in self._all_walls():
            denom = dx*(y2-y1) - dy*(x2-x1)
            if abs(denom) < 1e-9:
                continue
            ts = (dx*(ry-y1) - dy*(rx-x1)) / denom
            if not 0.0 <= ts <= 1.0:
                continue
            tr = ((x1-rx)+(x2-x1)*ts)/dx if abs(dx)>1e-9 else \
                 ((y1-ry)+(y2-y1)*ts)/dy
            if 0.05 < tr < best:
                best = tr
        return best + random.gauss(0, 0.006)

    # ── Width-aware gap detection ─────────────────────────────────────────────
    def _passage_clear(self, heading, threshold):
        """
        True if a passage of width 2×ROBOT_RADIUS in 'heading' direction is clear.
        We cast 3 rays: centre, and ±ROBOT_RADIUS laterally offset.
        All three must exceed 'threshold'.
        """
        # Lateral perpendicular unit vector
        perp_x = -math.sin(heading)
        perp_y =  math.cos(heading)
        # Lidar origin
        lo = 0.2
        lx = self.x + lo * math.cos(self.yaw)
        ly = self.y + lo * math.sin(self.yaw)

        for offset in (-ROBOT_RADIUS, 0.0, ROBOT_RADIUS):
            ox = lx + offset * perp_x
            oy = ly + offset * perp_y
            dx, dy = math.cos(heading), math.sin(heading)
            best = threshold + 0.5
            for (x1,y1),(x2,y2) in self._all_walls():
                denom = dx*(y2-y1) - dy*(x2-x1)
                if abs(denom) < 1e-9:
                    continue
                ts = (dx*(oy-y1) - dy*(ox-x1)) / denom
                if not 0.0 <= ts <= 1.0:
                    continue
                tr = ((x1-ox)+(x2-x1)*ts)/dx if abs(dx)>1e-9 else \
                     ((y1-oy)+(y2-y1)*ts)/dy
                if 0.02 < tr < best:
                    best = tr
            if best < threshold:
                return False
        return True

    def _forward_min(self):
        """Minimum clearance in the forward ±50° sector (11 rays)."""
        half = math.radians(50)
        mn   = float('inf')
        for i in range(11):
            ang = self.yaw - half + (2*half * i / 10)
            d = self._ray(ang, WARN_DIST + 0.5)
            if d < mn:
                mn = d
        return mn

    def _find_best_gap(self, goal_yaw, threshold):
        """
        Scan NUM_CAND_DIRS directions.
        Return the clear direction (passage fits robot) closest to goal_yaw.
        Falls back to the most open single ray if no full passage is found.
        """
        step = 2 * math.pi / NUM_CAND_DIRS

        best_heading = None
        best_score   = float('inf')    # angular distance to goal

        fallback_heading = None
        fallback_dist    = 0.0

        for i in range(NUM_CAND_DIRS):
            ang  = -math.pi + i * step
            d    = self._ray(ang, WARN_DIST + 1.0)
            to_g = abs(_wrap(ang - goal_yaw))

            if self._passage_clear(ang, threshold):
                if to_g < best_score:
                    best_score   = to_g
                    best_heading = ang
            else:
                if d > fallback_dist:
                    fallback_dist    = d
                    fallback_heading = ang

        return best_heading if best_heading is not None else fallback_heading

    # ── Stuck detection ───────────────────────────────────────────────────────
    def _record_pos(self):
        t = self.get_clock().now().nanoseconds * 1e-9
        self._pos_buf.append((t, self.x, self.y))

    def _is_stuck(self):
        if len(self._pos_buf) < 5:
            return False
        now = self._pos_buf[-1][0]
        cutoff = now - STUCK_WINDOW
        old = [(t,x,y) for t,x,y in self._pos_buf if t <= cutoff]
        if not old:
            return False
        t0, x0, y0 = old[-1]
        return math.hypot(self.x - x0, self.y - y0) < STUCK_MIN_TRAVEL

    # ── State transitions ─────────────────────────────────────────────────────
    def _enter_reverse(self):
        self.state       = State.REVERSE
        self.state_timer = 0.0
        self._pos_buf.clear()
        self.get_logger().warn('⬅  REVERSE: clearing stuck/emergency')

    def _enter_avoid(self, goal_yaw):
        self.state          = State.AVOID
        self.state_timer    = 0.0
        self._avoid_elapsed = 0.0
        self._avoid_yaw     = self._find_best_gap(goal_yaw, DANGER_DIST)
        self.get_logger().info(
            f'↩  AVOID: best gap @ {math.degrees(self._avoid_yaw or 0):.0f}°'
        )

    def _enter_navigate(self):
        self.state       = State.NAVIGATE
        self.state_timer = 0.0
        self._pos_buf.clear()

    # ── Physics update (20 Hz) ────────────────────────────────────────────────
    def update(self):
        now_msg = self.get_clock().now()
        self._record_pos()

        # ── Waypoint advance ──────────────────────────────────────────────────
        wx, wy = self.waypoints[self.wp_idx]
        if math.hypot(wx - self.x, wy - self.y) < WP_REACH:
            self.wp_idx = (self.wp_idx + 1) % len(self.waypoints)
            wx, wy = self.waypoints[self.wp_idx]
        goal_yaw = math.atan2(wy - self.y, wx - self.x)

        fwd_clear = self._forward_min()

        # ─────────────────────────────────────────────────────────────────────
        if self.state == State.REVERSE:
            self._do_reverse()

        # ─────────────────────────────────────────────────────────────────────
        elif self.state == State.AVOID:
            self._do_avoid(goal_yaw, fwd_clear)

        # ─────────────────────────────────────────────────────────────────────
        else:  # NAVIGATE
            self._do_navigate(goal_yaw, fwd_clear)

        # ── Odom publish ──────────────────────────────────────────────────────
        odom = Odometry()
        odom.header.stamp          = now_msg.to_msg()
        odom.header.frame_id       = 'odom'
        odom.child_frame_id        = 'base_link'
        odom.pose.pose.position.x  = self.x
        odom.pose.pose.position.y  = self.y
        odom.pose.pose.orientation = _quat(self.yaw)
        odom.twist.twist.linear.x  = self.vx
        odom.twist.twist.angular.z = self.wz
        for i in (0, 7, 35):
            odom.pose.covariance[i]  = 0.01 if i < 35 else 0.05
            odom.twist.covariance[i] = 0.01 if i < 35 else 0.05
        self.odom_pub.publish(odom)

    # ── Per-state drive logic ─────────────────────────────────────────────────
    def _do_navigate(self, goal_yaw, fwd_clear):
        """Normal waypoint following. Checks zones and triggers transitions."""
        self.state_timer += self.dt

        # Zone check
        if fwd_clear < EMERG_DIST:
            self.vx, self.wz = 0.0, 0.0
            self._enter_reverse()
            return

        if fwd_clear < DANGER_DIST:
            self._enter_avoid(goal_yaw)
            return

        if self._is_stuck():
            self._enter_reverse()
            return

        # Heading correction
        err   = _wrap(goal_yaw - self.yaw)
        speed = WARN_SPEED if fwd_clear < WARN_DIST else FWD_SPEED
        turn  = max(-ALIGN_SPEED * self.dt, min(ALIGN_SPEED * self.dt, err))
        self.yaw = _wrap(self.yaw + turn)
        self.wz  = turn / self.dt

        if abs(err) < math.radians(55):
            nx = self.x + speed * math.cos(self.yaw) * self.dt
            ny = self.y + speed * math.sin(self.yaw) * self.dt
            if not self._collides(nx, ny):
                self.x, self.y = nx, ny
                self.vx = speed
            else:
                # Physically blocked despite NAVIGATE — trigger reverse
                self.vx = 0.0
                self._enter_reverse()
        else:
            self.vx = 0.0

    def _do_avoid(self, goal_yaw, fwd_clear):
        """Committed avoidance: hold chosen gap heading for COMMIT_SECS."""
        self.state_timer    += self.dt
        self._avoid_elapsed += self.dt

        # Emergency while avoiding
        if fwd_clear < EMERG_DIST or self._is_stuck():
            self.vx, self.wz = 0.0, 0.0
            self._enter_reverse()
            return

        # Re-select gap after COMMIT_SECS
        if self._avoid_elapsed >= COMMIT_SECS:
            self._avoid_elapsed = 0.0
            new_gap = self._find_best_gap(goal_yaw, DANGER_DIST)
            if new_gap is not None:
                self._avoid_yaw = new_gap

        if self._avoid_yaw is None:
            # No gap found at all — reverse
            self._enter_reverse()
            return

        # Turn toward committed avoidance heading
        err  = _wrap(self._avoid_yaw - self.yaw)
        turn = max(-TURN_SPEED * self.dt, min(TURN_SPEED * self.dt, err))
        self.yaw = _wrap(self.yaw + turn)
        self.wz  = turn / self.dt

        # Move forward if aligned
        if abs(err) < math.radians(40):
            nx = self.x + FWD_SPEED * math.cos(self.yaw) * self.dt
            ny = self.y + FWD_SPEED * math.sin(self.yaw) * self.dt
            if not self._collides(nx, ny):
                self.x, self.y = nx, ny
                self.vx = FWD_SPEED
            else:
                self.vx = 0.0
        else:
            self.vx = 0.0

        # Transition back to NAVIGATE when forward is clear again
        if fwd_clear >= WARN_DIST and self.state_timer > 1.5:
            self._enter_navigate()

    def _do_reverse(self):
        """Reverse for REVERSE_SECS, then transition to NAVIGATE."""
        self.state_timer += self.dt

        # Turn slightly while reversing to change approach angle
        self.yaw = _wrap(self.yaw + 0.3 * self.dt)
        self.wz  = 0.3

        nx = self.x - REV_SPEED * math.cos(self.yaw) * self.dt
        ny = self.y - REV_SPEED * math.sin(self.yaw) * self.dt
        if not self._collides(nx, ny):
            self.x, self.y = nx, ny
            self.vx = -REV_SPEED
        else:
            # Blocked backward too — try turning more aggressively
            self.yaw = _wrap(self.yaw + TURN_SPEED * self.dt)
            self.vx  = 0.0

        if self.state_timer >= REVERSE_SECS:
            self.get_logger().info('▶  Reversing done — back to NAVIGATE')
            self._enter_navigate()

    # ── Sensor publishers ─────────────────────────────────────────────────────
    def publish_heartbeat(self):
        self.heartbeat_pub.publish(Empty())

    def publish_scan(self):
        N, rmin, rmax, rate = 1600, 0.15, 12.0, 10.0
        amin = -math.pi
        ainc = 2 * math.pi / N
        ranges = []
        for i in range(N):
            d = self._ray(self.yaw + amin + i*ainc, rmax)
            ranges.append(float('inf') if d < rmin else float(min(d, rmax)))
        s = LaserScan()
        s.header.stamp    = self.get_clock().now().to_msg()
        s.header.frame_id = 'lidar_link'
        s.angle_min       = amin
        s.angle_max       = math.pi
        s.angle_increment = ainc
        s.time_increment  = (1.0/rate) / N
        s.scan_time       = 1.0 / rate
        s.range_min       = rmin
        s.range_max       = rmax
        s.ranges          = ranges
        s.intensities     = [100.0] * N
        self.scan_pub.publish(s)

    def publish_imu(self):
        imu = Imu()
        imu.header.stamp              = self.get_clock().now().to_msg()
        imu.header.frame_id           = 'imu_link'
        imu.orientation               = _quat(self.yaw)
        imu.angular_velocity.z        = self.wz + random.gauss(0, 0.003)
        imu.linear_acceleration.x     = abs(self.vx) * 0.1 + random.gauss(0, 0.05)
        imu.linear_acceleration.z     = 9.81 + random.gauss(0, 0.05)
        imu.orientation_covariance[8]         = 0.01
        imu.angular_velocity_covariance[8]    = 0.005
        imu.linear_acceleration_covariance[0] = 0.1
        imu.linear_acceleration_covariance[4] = 0.1
        imu.linear_acceleration_covariance[8] = 0.1
        self.imu_pub.publish(imu)


def main(args=None):
    rclpy.init(args=args)
    node = FakeSensorPublisher()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
