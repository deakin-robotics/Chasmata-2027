cmake_minimum_required(VERSION 3.8)
project(dcr_ee_driver)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Find dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(can_msgs REQUIRED)
find_package(arm_interfaces REQUIRED)

# Build end effector driver node
add_executable(ee_driver_node src/ee_driver_node.cpp)
target_compile_features(ee_driver_node PUBLIC cxx_std_17)
ament_target_dependencies(
  ee_driver_node
  rclcpp
  can_msgs
  arm_interfaces
)

# Install the executable
install(
  TARGETS ee_driver_node
  DESTINATION lib/${PROJECT_NAME})

# Install config and launch files
install(
  DIRECTORY config
  DESTINATION share/${PROJECT_NAME})

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()
