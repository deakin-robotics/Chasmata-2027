#pragma once

#include <memory>

#include <rclcpp/node.hpp>

namespace rover_bringup
{
std::shared_ptr<rclcpp::Node> make_rover_control_node();
}  // namespace rover_bringup
