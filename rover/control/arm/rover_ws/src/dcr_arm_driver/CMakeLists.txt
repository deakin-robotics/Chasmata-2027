cmake_minimum_required(VERSION 3.8)
project(dcr_arm_driver)

# Compiler flags
if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Find dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_lifecycle REQUIRED)
find_package(hardware_interface REQUIRED)
find_package(pluginlib REQUIRED)
find_package(can_msgs REQUIRED)
find_package(arm_interfaces REQUIRED)
find_package(std_msgs REQUIRED)
find_package(std_srvs REQUIRED)
find_package(action_msgs REQUIRED)
find_package(rosidl_default_generators REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/DirectDrive.msg"
)
rosidl_get_typesupport_target(direct_drive_typesupport ${PROJECT_NAME}
  "rosidl_typesupport_cpp")

# Build motor driver library
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
  std_msgs
)

# Build hardware interface plugin.
# Must be a SHARED library - pluginlib loads plugins via dlopen at runtime.
add_library(arm_hardware_interface SHARED src/arm_hardware_interface.cpp)
target_include_directories(arm_hardware_interface PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(arm_hardware_interface PUBLIC cxx_std_17)
ament_target_dependencies(
  arm_hardware_interface
  hardware_interface
  pluginlib
  rclcpp
  rclcpp_lifecycle
  can_msgs
  arm_interfaces
  std_msgs
  std_srvs
  action_msgs
)
target_link_libraries(arm_hardware_interface dcr_arm_driver_lib "${direct_drive_typesupport}")

# Install headers
install(
  DIRECTORY include/
  DESTINATION include)

# Install libraries
install(
  TARGETS dcr_arm_driver_lib arm_hardware_interface
  EXPORT export_${PROJECT_NAME}
  LIBRARY DESTINATION lib
  ARCHIVE DESTINATION lib
  RUNTIME DESTINATION bin)

# Install config and urdf files
install(
  DIRECTORY config urdf
  DESTINATION share/${PROJECT_NAME})

# Install plugin XML file
install(
  FILES plugins.xml
  DESTINATION share/${PROJECT_NAME})

# Register the plugin description with pluginlib so controller_manager can
# discover "dcr_arm_driver/ArmHardwareInterface". Without this the class is
# not exported and hardware loading fails with a LibraryLoadException.
pluginlib_export_plugin_description_file(
  hardware_interface plugins.xml)

# Export targets and dependencies
ament_export_targets(export_${PROJECT_NAME} HAS_LIBRARY_TARGET)
ament_export_dependencies(
  hardware_interface
  pluginlib
  rclcpp
  rclcpp_lifecycle
  can_msgs
  arm_interfaces
  std_msgs
  std_srvs
  action_msgs
)

ament_export_dependencies(rosidl_default_runtime)

if(BUILD_TESTING)
  find_package(ament_cmake_gtest REQUIRED)
  ament_add_gtest(test_direct_drive test/test_direct_drive.cpp)
  target_link_libraries(test_direct_drive arm_hardware_interface)
  ament_target_dependencies(test_direct_drive hardware_interface rclcpp rclcpp_lifecycle
    can_msgs arm_interfaces std_msgs std_srvs action_msgs)
endif()

# Finalize package
ament_package()
