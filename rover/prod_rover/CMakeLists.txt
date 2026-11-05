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
find_package(controller_manager_msgs REQUIRED)
find_package(dcr_arm_driver REQUIRED)
find_package(ecam_alerts REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(telemetry_interfaces REQUIRED)
find_package(builtin_interfaces REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME} "srv/SetArmControlMode.srv")
rosidl_get_typesupport_target(prod_rover_typesupport ${PROJECT_NAME} "rosidl_typesupport_cpp")

add_library(prod_rover_control SHARED src/rover_control.cpp)
target_link_libraries(prod_rover_control "${prod_rover_typesupport}")
target_include_directories(prod_rover_control PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
ament_target_dependencies(prod_rover_control rclcpp std_msgs telemetry_interfaces)

add_library(arm_control SHARED src/arm_control.cpp)
target_link_libraries(arm_control "${prod_rover_typesupport}" ecam_alerts::ecam_alerts)
target_include_directories(arm_control PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
ament_target_dependencies(arm_control controller_manager_msgs dcr_arm_driver rclcpp sensor_msgs std_msgs telemetry_interfaces)

add_executable(prod_rover_main src/main.cpp)
set_target_properties(prod_rover_main PROPERTIES OUTPUT_NAME prod_rover)
target_link_libraries(prod_rover_main prod_rover_control arm_control)
ament_target_dependencies(prod_rover_main rclcpp)

install(TARGETS prod_rover_control arm_control prod_rover_main
  EXPORT export_${PROJECT_NAME}
  ARCHIVE DESTINATION lib LIBRARY DESTINATION lib RUNTIME DESTINATION lib/${PROJECT_NAME})
install(DIRECTORY include/ DESTINATION include)
install(DIRECTORY launch/ DESTINATION share/${PROJECT_NAME}/launch)
install(FILES README.md DESTINATION share/${PROJECT_NAME})

ament_export_targets(export_${PROJECT_NAME} HAS_LIBRARY_TARGET)
ament_export_include_directories(include)

ament_package()
