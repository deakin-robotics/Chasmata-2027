cmake_minimum_required(VERSION 3.8)
project(telemetry_interfaces)

find_package(ament_cmake REQUIRED)
find_package(builtin_interfaces REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(nav_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(rosidl_default_generators REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/ArmMoveItStatus.msg"
  "msg/ArmControlStatus.msg"
  "msg/ArmOverrideState.msg"
  "msg/EcamAlertSourceSnapshot.msg"
  "msg/EcamAlerts.msg"
  "msg/FmaModeState.msg"
  "msg/FmaState.msg"
  "msg/RecoveryMotorStatus.msg"
  "msg/RecoveryArmCommand.msg"
  "msg/RecoverySnapshot.msg"
  DEPENDENCIES builtin_interfaces sensor_msgs nav_msgs geometry_msgs
)

ament_export_dependencies(rosidl_default_runtime)

ament_package()
