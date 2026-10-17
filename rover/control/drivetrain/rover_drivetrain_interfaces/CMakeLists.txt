cmake_minimum_required(VERSION 3.8)
project(rover_drivetrain_interfaces)
find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(builtin_interfaces REQUIRED)
# Read-only telemetry and diagnostics. No motor-command interfaces: all motor
# commands go through ros2_control.
rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/WheelTelemetry.msg"
  "msg/DrivetrainTelemetry.msg"
  "srv/ReadMotorDiagnostic.srv"
  DEPENDENCIES builtin_interfaces
)
ament_export_dependencies(rosidl_default_runtime)
ament_package()
