#pragma once

#include <memory>

#include <rclcpp/node.hpp>

namespace prod_rover
{
std::shared_ptr<rclcpp::Node> make_arm_control_node();
}  // namespace prod_rover
