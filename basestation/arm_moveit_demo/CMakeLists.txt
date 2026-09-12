cmake_minimum_required(VERSION 3.22)
project(arm_moveit_demo)

find_package(ament_cmake REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(moveit_ros_planning_interface REQUIRED)
find_package(rclcpp REQUIRED)

add_executable(plan_and_execute src/plan_and_execute.cpp)
ament_target_dependencies(
  plan_and_execute
  geometry_msgs
  moveit_ros_planning_interface
  rclcpp
)

install(TARGETS plan_and_execute DESTINATION lib/${PROJECT_NAME})

ament_package()
