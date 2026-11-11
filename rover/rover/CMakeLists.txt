cmake_minimum_required(VERSION 3.8)
project(rover)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(control_msgs REQUIRED)
find_package(dcr_arm_driver REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(controller_manager_msgs REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(std_srvs REQUIRED)
find_package(telemetry_interfaces REQUIRED)

add_library(rover_simulation SHARED src/arm/joint_simulator.cpp)
target_include_directories(rover_simulation PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)

add_library(rover_node SHARED
  src/rover/rover_node.cpp
  src/rover/fma_control.cpp
  src/drive/mock_drive_backend.cpp
  src/drive/real_drive_backend.cpp
  src/arm/mock_arm_backend.cpp
  src/arm/real_arm_backend.cpp
  src/arm/arm_control.cpp
  src/arm/trajectory.cpp)
target_link_libraries(rover_node rover_simulation)
target_include_directories(rover_node PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
ament_target_dependencies(rover_node
  control_msgs controller_manager_msgs dcr_arm_driver geometry_msgs rclcpp rclcpp_action sensor_msgs std_msgs std_srvs telemetry_interfaces)

add_executable(rover src/rover/rover_main.cpp)
target_link_libraries(rover rover_node)
ament_target_dependencies(rover rclcpp)

install(TARGETS rover_simulation rover_node rover
  EXPORT export_${PROJECT_NAME}
  ARCHIVE DESTINATION lib LIBRARY DESTINATION lib RUNTIME DESTINATION lib/${PROJECT_NAME})
install(DIRECTORY include/ DESTINATION include)
install(DIRECTORY launch/ DESTINATION share/${PROJECT_NAME}/launch)
install(DIRECTORY config/ DESTINATION share/${PROJECT_NAME}/config)
install(FILES README.md DESTINATION share/${PROJECT_NAME})

ament_export_targets(export_${PROJECT_NAME} HAS_LIBRARY_TARGET)
ament_export_include_directories(include)

if(BUILD_TESTING)
  find_package(ament_cmake_gtest REQUIRED)
  find_package(hardware_interface REQUIRED)
  find_package(rclcpp_lifecycle REQUIRED)
  find_package(can_msgs REQUIRED)
  find_package(arm_interfaces REQUIRED)
  find_package(action_msgs REQUIRED)
  ament_add_gtest(test_joint_simulator test/test_joint_simulator.cpp)
  target_link_libraries(test_joint_simulator rover_simulation)
  ament_add_gtest(test_rover_integration test/test_rover_integration.cpp)
  target_link_libraries(test_rover_integration rover_node)
  ament_target_dependencies(test_rover_integration
    control_msgs rclcpp rclcpp_action sensor_msgs std_msgs std_srvs telemetry_interfaces)
  ament_add_gtest(test_arm_backend test/test_arm_backend.cpp)
  target_link_libraries(test_arm_backend rover_node)
  ament_target_dependencies(test_arm_backend control_msgs dcr_arm_driver rclcpp rclcpp_action sensor_msgs std_msgs std_srvs telemetry_interfaces)
  ament_add_gtest(test_position_arm_backend test/test_position_arm_backend.cpp)
  target_link_libraries(test_position_arm_backend rover_node)
  ament_target_dependencies(test_position_arm_backend control_msgs controller_manager_msgs dcr_arm_driver
    rclcpp rclcpp_action sensor_msgs std_msgs telemetry_interfaces)
  ament_add_gtest(test_real_arm_integration test/test_real_arm_integration.cpp)
  target_link_libraries(test_real_arm_integration rover_node dcr_arm_driver::arm_hardware_interface)
  ament_target_dependencies(test_real_arm_integration control_msgs controller_manager_msgs dcr_arm_driver hardware_interface rclcpp rclcpp_action rclcpp_lifecycle
    can_msgs arm_interfaces std_msgs std_srvs action_msgs telemetry_interfaces sensor_msgs)
  ament_add_gtest(test_real_drive_backend test/test_real_drive_backend.cpp)
  target_include_directories(test_real_drive_backend PRIVATE src/drive)
  target_link_libraries(test_real_drive_backend rover_node)
  ament_target_dependencies(test_real_drive_backend controller_manager_msgs geometry_msgs rclcpp sensor_msgs std_msgs telemetry_interfaces)
endif()

ament_package()
