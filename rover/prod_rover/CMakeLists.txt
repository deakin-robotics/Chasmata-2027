cmake_minimum_required(VERSION 3.8)
project(prod_rover)

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
find_package(rclcpp REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(telemetry_interfaces REQUIRED)

add_library(prod_rover_simulation SHARED src/joint_simulator.cpp)
target_include_directories(prod_rover_simulation PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)

add_library(prod_rover_node SHARED src/rover_node.cpp)
target_link_libraries(prod_rover_node prod_rover_simulation)
target_include_directories(prod_rover_node PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
ament_target_dependencies(prod_rover_node
  control_msgs rclcpp rclcpp_action sensor_msgs std_msgs telemetry_interfaces)

add_executable(prod_rover src/main.cpp)
target_link_libraries(prod_rover prod_rover_node)
ament_target_dependencies(prod_rover rclcpp)

install(TARGETS prod_rover_simulation prod_rover_node prod_rover
  EXPORT export_${PROJECT_NAME}
  ARCHIVE DESTINATION lib LIBRARY DESTINATION lib RUNTIME DESTINATION lib/${PROJECT_NAME})
install(DIRECTORY include/ DESTINATION include)
install(DIRECTORY launch/ DESTINATION share/${PROJECT_NAME}/launch)
install(FILES README.md DESTINATION share/${PROJECT_NAME})

ament_export_targets(export_${PROJECT_NAME} HAS_LIBRARY_TARGET)
ament_export_include_directories(include)

if(BUILD_TESTING)
  find_package(ament_cmake_gtest REQUIRED)
  ament_add_gtest(test_joint_simulator test/test_joint_simulator.cpp)
  target_link_libraries(test_joint_simulator prod_rover_simulation)
  ament_add_gtest(test_rover_integration test/test_rover_integration.cpp)
  target_link_libraries(test_rover_integration prod_rover_node)
  ament_target_dependencies(test_rover_integration
    control_msgs rclcpp rclcpp_action sensor_msgs std_msgs telemetry_interfaces)
endif()

ament_package()
