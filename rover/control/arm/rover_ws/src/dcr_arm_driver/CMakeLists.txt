cmake_minimum_required(VERSION 3.8)
project(dcr_arm_driver)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(can_msgs REQUIRED)
find_package(arm_interfaces REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(rcl_interfaces REQUIRED)
find_package(std_msgs REQUIRED)

# Motor library
add_library(dcr_arm_driver_lib src/motor.cpp)
target_include_directories(dcr_arm_driver_lib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(dcr_arm_driver_lib PUBLIC cxx_std_17)
ament_target_dependencies(
  dcr_arm_driver_lib
  rclcpp
  can_msgs
  arm_interfaces
)

# Controller library
add_library(dcr_arm_controller src/controller.cpp)
target_include_directories(dcr_arm_controller PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(dcr_arm_controller PUBLIC cxx_std_17)
target_link_libraries(dcr_arm_controller dcr_arm_driver_lib)
ament_target_dependencies(
  dcr_arm_controller
  rclcpp
  can_msgs
  arm_interfaces
  sensor_msgs
  rcl_interfaces
  std_msgs
)

# Executable
add_executable(arm_controller_node src/controller_node.cpp)
target_link_libraries(arm_controller_node dcr_arm_controller)
target_compile_features(arm_controller_node PUBLIC cxx_std_17)

install(
  DIRECTORY include/
  DESTINATION include)
install(
  TARGETS dcr_arm_driver_lib dcr_arm_controller arm_controller_node
  EXPORT export_${PROJECT_NAME}
  LIBRARY DESTINATION lib
  ARCHIVE DESTINATION lib
  RUNTIME DESTINATION bin)

ament_export_targets(export_${PROJECT_NAME} HAS_LIBRARY_TARGET)
ament_export_dependencies(
  rclcpp
  can_msgs
  arm_interfaces
  sensor_msgs
  rcl_interfaces
  std_msgs
)

ament_package()