cmake_minimum_required(VERSION 3.22)
project(arm_moveit_bridge)

find_package(ament_cmake REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(moveit_ros_planning_interface REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)

add_executable(arm_moveit_bridge src/arm_moveit_bridge.cpp)
ament_target_dependencies(arm_moveit_bridge
  geometry_msgs
  moveit_ros_planning_interface
  rclcpp
  sensor_msgs
)

install(TARGETS arm_moveit_bridge
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
