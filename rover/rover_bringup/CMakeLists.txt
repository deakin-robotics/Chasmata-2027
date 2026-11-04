cmake_minimum_required(VERSION 3.8)
project(rover_bringup)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(std_msgs REQUIRED)
find_package(telemetry_interfaces REQUIRED)

add_library(rover_control_node SHARED src/rover_control_node.cpp)
target_include_directories(rover_control_node PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
ament_target_dependencies(rover_control_node rclcpp std_msgs telemetry_interfaces)

add_executable(rover_control src/rover_control_main.cpp)
target_link_libraries(rover_control rover_control_node)
ament_target_dependencies(rover_control rclcpp)

install(TARGETS rover_control_node rover_control
  EXPORT export_${PROJECT_NAME}
  ARCHIVE DESTINATION lib LIBRARY DESTINATION lib RUNTIME DESTINATION lib/${PROJECT_NAME})
install(DIRECTORY include/ DESTINATION include)
install(DIRECTORY launch/ DESTINATION share/${PROJECT_NAME}/launch)
install(FILES README.md DESTINATION share/${PROJECT_NAME})

ament_export_targets(export_${PROJECT_NAME} HAS_LIBRARY_TARGET)
ament_export_include_directories(include)

if(BUILD_TESTING)
  find_package(ament_cmake_gtest REQUIRED)
  ament_add_gtest(test_rover_control test/test_rover_control.cpp)
  target_link_libraries(test_rover_control rover_control_node)
  ament_target_dependencies(test_rover_control rclcpp std_msgs telemetry_interfaces)
endif()

ament_package()
