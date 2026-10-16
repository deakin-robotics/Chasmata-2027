cmake_minimum_required(VERSION 3.8)
project(rover_drivetrain_control)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(hardware_interface REQUIRED)
find_package(pluginlib REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_lifecycle REQUIRED)
find_package(rover_drivetrain_interfaces REQUIRED)
find_package(std_msgs REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBMODBUS REQUIRED IMPORTED_TARGET libmodbus)

# Pure C++ core: no ROS or libmodbus; unit tests work without physical hardware.
add_library(${PROJECT_NAME}_core STATIC src/drivetrain_core.cpp)
set_target_properties(${PROJECT_NAME}_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(${PROJECT_NAME}_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)

add_library(${PROJECT_NAME} SHARED
  src/bld305s_driver.cpp
  src/rover_hardware_interface.cpp)
target_include_directories(${PROJECT_NAME} PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)

# Jazzy ament_target_dependencies uses the PLAIN target_link_libraries signature
# internally. Avoid mixing with keyword PRIVATE/PUBLIC on this same target.
ament_target_dependencies(${PROJECT_NAME}
  hardware_interface pluginlib rclcpp rclcpp_lifecycle)
target_link_libraries(${PROJECT_NAME}
  ${PROJECT_NAME}_core
  PkgConfig::LIBMODBUS)

pluginlib_export_plugin_description_file(hardware_interface
  rover_drivetrain_control_plugins.xml)

# Diagnostic-only node. Motion service always REJECTS motion commands.
add_executable(drivetrain_diagnostics_node src/drivetrain_diagnostics_node.cpp)
ament_target_dependencies(drivetrain_diagnostics_node
  rclcpp rover_drivetrain_interfaces)
target_link_libraries(drivetrain_diagnostics_node ${PROJECT_NAME})

install(TARGETS ${PROJECT_NAME} ${PROJECT_NAME}_core
  EXPORT export_${PROJECT_NAME}
  ARCHIVE DESTINATION lib LIBRARY DESTINATION lib RUNTIME DESTINATION bin)
# Standalone plugin discovery/loading check. Instantiates only; never calls
# on_init(), opens a port, or commands a motor.
add_executable(check_drivetrain_plugin src/check_drivetrain_plugin.cpp)
ament_target_dependencies(check_drivetrain_plugin
  hardware_interface pluginlib)

# AD-24 direct drive: forwards per-wheel speeds to wheel_velocity_controller
# (ros2_control), zeros on timeout. Never talks to the drives.
add_executable(direct_drive_relay src/direct_drive_relay.cpp)
ament_target_dependencies(direct_drive_relay rclcpp std_msgs)
target_link_libraries(direct_drive_relay ${PROJECT_NAME}_core)

install(TARGETS drivetrain_diagnostics_node check_drivetrain_plugin direct_drive_relay
  DESTINATION lib/${PROJECT_NAME})
install(DIRECTORY include/ DESTINATION include)
install(DIRECTORY launch config docs urdf DESTINATION share/${PROJECT_NAME})
install(FILES README.md DESTINATION share/${PROJECT_NAME})

ament_export_targets(export_${PROJECT_NAME} HAS_LIBRARY_TARGET)
ament_export_include_directories(include)
ament_export_dependencies(hardware_interface pluginlib rclcpp rclcpp_lifecycle)

if(BUILD_TESTING)
  enable_testing()
  add_executable(test_drivetrain_core test/test_drivetrain_core.cpp)
  target_link_libraries(test_drivetrain_core ${PROJECT_NAME}_core)
  add_test(NAME drivetrain_core_logic COMMAND test_drivetrain_core)

  # Mock all wire functions: verifies per-slave, per-cycle failure accounting
  # without opening any real serial ports or sending motor commands.
  add_executable(test_driver_mock test/test_driver_mock.cpp src/bld305s_driver.cpp)
  target_include_directories(test_driver_mock PRIVATE include ${LIBMODBUS_INCLUDE_DIRS})
  target_link_libraries(test_driver_mock ${PROJECT_NAME}_core)
  add_test(NAME drivetrain_modbus_mock COMMAND test_driver_mock)

  # Unpopulated telemetry must never claim success or valid data.
  add_executable(test_telemetry_defaults test/test_telemetry_defaults.cpp)
  ament_target_dependencies(test_telemetry_defaults rover_drivetrain_interfaces)
  add_test(NAME drivetrain_telemetry_defaults COMMAND test_telemetry_defaults)
endif()
ament_package()
