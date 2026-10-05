cmake_minimum_required(VERSION 3.8)

project(rover_drivetrain_control)

# ---------------------------------------------------------------------------
# Compiler configuration
# ---------------------------------------------------------------------------

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()

set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(
    -Wall
    -Wextra
    -Wpedantic
  )
endif()

# ---------------------------------------------------------------------------
# ROS 2 / ament dependencies
# ---------------------------------------------------------------------------

find_package(ament_cmake REQUIRED)

find_package(hardware_interface REQUIRED)
find_package(pluginlib REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_lifecycle REQUIRED)

# ---------------------------------------------------------------------------
# libmodbus
# ---------------------------------------------------------------------------

find_package(PkgConfig REQUIRED)

pkg_check_modules(
  LIBMODBUS
  REQUIRED
  IMPORTED_TARGET
  libmodbus
)

# ---------------------------------------------------------------------------
# Hardware plugin library
# ---------------------------------------------------------------------------

add_library(
  ${PROJECT_NAME}
  SHARED
  src/bld305s_driver.cpp
  src/rover_hardware_interface.cpp
)

target_include_directories(
  ${PROJECT_NAME}
  PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

ament_target_dependencies(
  ${PROJECT_NAME}
  hardware_interface
  pluginlib
  rclcpp
  rclcpp_lifecycle
)

target_link_libraries(
  ${PROJECT_NAME}
  PkgConfig::LIBMODBUS
)

# ---------------------------------------------------------------------------
# pluginlib registration
# ---------------------------------------------------------------------------

pluginlib_export_plugin_description_file(
  hardware_interface
  rover_drivetrain_control_plugins.xml
)

# ---------------------------------------------------------------------------
# Installation
# ---------------------------------------------------------------------------

install(
  TARGETS ${PROJECT_NAME}
  EXPORT export_${PROJECT_NAME}
  ARCHIVE DESTINATION lib
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION bin
)

install(
  DIRECTORY include/
  DESTINATION include
)

ament_export_targets(
  export_${PROJECT_NAME}
  HAS_LIBRARY_TARGET
)

ament_export_include_directories(
  include
)

ament_export_dependencies(
  hardware_interface
  pluginlib
  rclcpp
  rclcpp_lifecycle
)

ament_package()
