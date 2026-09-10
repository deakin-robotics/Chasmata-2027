"""Pure-Python pieces of the mock rover simulation.

Keeping the joint simulation independent of rclpy makes its safety and motion
behaviour testable on a normal development machine as well as inside ROS 2.
"""

from typing import Dict, Iterable, Mapping, Tuple


JointLimits = Mapping[str, Tuple[float, float]]


class JointSimulator:
    """Moves simulated joints toward a target with speed and limit checks."""

    def __init__(
        self,
        joint_names: Iterable[str],
        joint_limits: JointLimits,
        max_speed_rad_s: float,
    ) -> None:
        if max_speed_rad_s <= 0:
            raise ValueError('max_speed_rad_s must be greater than zero')

        self.joint_names = tuple(joint_names)
        self.joint_limits = dict(joint_limits)
        self.max_speed_rad_s = max_speed_rad_s
        self._positions: Dict[str, float] = {}
        self._targets: Dict[str, float] = {}
        self._velocities: Dict[str, float] = {}

        for name in self.joint_names:
            lower, upper = self.joint_limits[name]
            if lower > upper:
                raise ValueError(f'Invalid limits for {name}')

            self._positions[name] = min(max(0.0, lower), upper)
            self._targets[name] = self._positions[name]
            self._velocities[name] = 0.0

    def set_target(self, joint_values: Mapping[str, float]) -> Dict[str, float]:
        """Set finite targets and return the values after limit clamping."""
        clamped: Dict[str, float] = {}

        for name, value in joint_values.items():
            if name not in self._targets:
                continue
            if not isinstance(value, (int, float)):
                continue

            lower, upper = self.joint_limits[name]
            bounded_value = min(max(float(value), lower), upper)
            self._targets[name] = bounded_value
            clamped[name] = bounded_value

        return clamped

    def step(self, elapsed_seconds: float) -> None:
        """Advance each joint by at most max speed times elapsed time."""
        if elapsed_seconds <= 0:
            return

        max_delta = self.max_speed_rad_s * elapsed_seconds

        for name in self.joint_names:
            current = self._positions[name]
            target = self._targets[name]
            delta = target - current
            movement = min(max(delta, -max_delta), max_delta)
            self._positions[name] = current + movement
            self._velocities[name] = movement / elapsed_seconds

            if abs(target - self._positions[name]) < 1e-9:
                self._positions[name] = target
                self._velocities[name] = 0.0

    def positions(self) -> Dict[str, float]:
        return dict(self._positions)

    def velocities(self) -> Dict[str, float]:
        return dict(self._velocities)
