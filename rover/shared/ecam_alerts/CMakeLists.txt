cmake_minimum_required(VERSION 3.8)
project(ecam_alerts)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(builtin_interfaces REQUIRED)
find_package(rclcpp REQUIRED)
find_package(std_msgs REQUIRED)
find_package(telemetry_interfaces REQUIRED)

add_library(ecam_alerts SHARED src/source.cpp src/state.cpp src/aggregator.cpp)
target_include_directories(ecam_alerts PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
ament_target_dependencies(ecam_alerts builtin_interfaces rclcpp std_msgs telemetry_interfaces)

add_executable(ecam_alert_aggregator src/ecam_alert_aggregator_main.cpp)
target_link_libraries(ecam_alert_aggregator ecam_alerts)
ament_target_dependencies(ecam_alert_aggregator rclcpp)

install(TARGETS ecam_alerts ecam_alert_aggregator
  EXPORT export_${PROJECT_NAME}
  ARCHIVE DESTINATION lib LIBRARY DESTINATION lib RUNTIME DESTINATION bin)
install(DIRECTORY include/ DESTINATION include)
install(DIRECTORY launch/ DESTINATION share/${PROJECT_NAME}/launch)
install(FILES README.md DESTINATION share/${PROJECT_NAME})

ament_export_targets(export_${PROJECT_NAME} HAS_LIBRARY_TARGET)
ament_export_include_directories(include)
ament_export_dependencies(builtin_interfaces rclcpp std_msgs telemetry_interfaces)

if(BUILD_TESTING)
  find_package(ament_cmake_gtest REQUIRED)
  ament_add_gtest(test_state test/test_state.cpp)
  target_link_libraries(test_state ecam_alerts)
  ament_target_dependencies(test_state rclcpp)
  ament_add_gtest(test_aggregation test/test_aggregation.cpp)
  target_link_libraries(test_aggregation ecam_alerts)
  ament_target_dependencies(test_aggregation rclcpp std_msgs telemetry_interfaces)
endif()

ament_package()
