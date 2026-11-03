#!/usr/bin/env python3
"""
obstacle_server.py
==================
Hosts 2 interactive marker obstacles in RViz that the user can drag
freely in the XY plane during simulation.

How it works
------------
* Two orange boxes (0.6 m × 0.6 m) are placed on the robot's square path.
* Drag either box in RViz → the server receives feedback → publishes the
  updated positions to /sim_obstacle_poses (geometry_msgs/PoseArray).
* fake_sensors.py subscribes to that topic and adds the boxes to its
  ray-caster so the LiDAR immediately sees the moved obstacle.

Place the obstacles ON the path to block the robot; place them OFF the
path to see the rover drive freely.  Map updates happen in real time.
"""

import rclpy
from rclpy.node import Node

from geometry_msgs.msg import PoseArray, Pose
from visualization_msgs.msg import (
    InteractiveMarker,
    InteractiveMarkerControl,
    Marker,
)
from interactive_markers.interactive_marker_server import InteractiveMarkerServer


# Half-size of the obstacle box (metres).  Full width = 2 × HALF_SIZE.
HALF_SIZE = 0.30   # → 0.6 m × 0.6 m box

# Initial positions — deliberately OFF the drive path so the rover moves
# freely on launch.  Drag a box onto the path in RViz to trigger avoidance.
#
# Square path reference: (2,2)→(5,2)→(5,5)→(2,5)→(2,2)
# Obstacle 1: south-west corner (safe zone)
# Obstacle 2: north-east corner (safe zone)
INITIAL_POSITIONS = [
    (0.5, 0.5, 'obstacle_1'),    # south-west — off path
    (6.0, 6.0, 'obstacle_2'),    # north-east — off path
]


def _make_box_visual(r, g, b):
    """Return a Marker (CUBE) used as the visual representation."""
    m = Marker()
    m.type = Marker.CUBE
    m.scale.x = HALF_SIZE * 2.0
    m.scale.y = HALF_SIZE * 2.0
    m.scale.z = 0.50            # 0.5 m tall — visible in RViz
    m.color.r = r
    m.color.g = g
    m.color.b = b
    m.color.a = 0.85
    return m


def _make_obstacle_marker(name, x, y, r, g, b):
    """Build a full InteractiveMarker with MOVE_PLANE (XY) interaction."""
    im = InteractiveMarker()
    im.header.frame_id = 'map'
    im.name = name
    im.description = f'{name}  (drag me)'
    im.scale = 0.8

    im.pose.position.x = float(x)
    im.pose.position.y = float(y)
    im.pose.position.z = 0.25   # visually half the box height
    im.pose.orientation.w = 1.0

    # ── Control: visual + MOVE_PLANE in the XY ground plane ──────────────
    # For MOVE_PLANE the control orientation x-axis is the plane normal.
    # Rotating the default x-axis (1,0,0) to world z (0,0,1) requires a
    # -90° rotation around Y → quaternion (w=0.707, x=0, y=-0.707, z=0).
    ctrl = InteractiveMarkerControl()
    ctrl.orientation.w = 0.707107
    ctrl.orientation.x = 0.0
    ctrl.orientation.y = -0.707107
    ctrl.orientation.z = 0.0
    ctrl.interaction_mode = InteractiveMarkerControl.MOVE_PLANE
    ctrl.always_visible = True
    ctrl.markers.append(_make_box_visual(r, g, b))
    im.controls.append(ctrl)

    return im


class ObstacleServer(Node):

    def __init__(self):
        super().__init__('obstacle_server')

        # Publisher: lets fake_sensors.py know where the obstacles are
        self._pub = self.create_publisher(PoseArray, '/sim_obstacle_poses', 10)

        # Interactive marker server (manages RViz interaction)
        self._server = InteractiveMarkerServer(self, 'sim_obstacles')

        # Obstacle state: name → (x, y)
        self._positions = {}

        # Register all obstacles
        configs = [
            # (x,  y,  name,         R,    G,    B  )
            (INITIAL_POSITIONS[0][0], INITIAL_POSITIONS[0][1],
             INITIAL_POSITIONS[0][2], 1.0,  0.55, 0.0),   # orange
            (INITIAL_POSITIONS[1][0], INITIAL_POSITIONS[1][1],
             INITIAL_POSITIONS[1][2], 0.2,  0.6,  1.0),   # blue
        ]
        for x, y, name, r, g, b in configs:
            im = _make_obstacle_marker(name, x, y, r, g, b)
            self._server.insert(im, feedback_callback=self._on_feedback)
            self._positions[name] = (x, y)

        self._server.applyChanges()

        # Publish initial positions once
        self._publish()
        self.get_logger().info(
            'Obstacle server ready.  Drag the orange/blue boxes in RViz. '
            f'Positions published to /sim_obstacle_poses'
        )

    # ── Feedback callback (called whenever the user moves a marker) ───────
    def _on_feedback(self, feedback):
        name = feedback.marker_name
        x = feedback.pose.position.x
        y = feedback.pose.position.y
        self._positions[name] = (x, y)
        # Keep Z locked so the box doesn't float away
        pose = feedback.pose
        pose.position.z = 0.25
        self._server.setPose(name, pose)
        self._server.applyChanges()
        self._publish()

    # ── Publish current positions ─────────────────────────────────────────
    def _publish(self):
        msg = PoseArray()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = 'map'
        for (x, y) in self._positions.values():
            p = Pose()
            p.position.x = float(x)
            p.position.y = float(y)
            p.position.z = 0.0
            p.orientation.w = 1.0
            msg.poses.append(p)
        self._pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = ObstacleServer()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
