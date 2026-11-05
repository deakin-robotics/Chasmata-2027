#pragma once

#include <memory>

#include <rclcpp/node.hpp>

namespace prod_rover
{
std::shared_ptr<rclcpp::Node> make_prod_rover_node();
}  // namespace prod_rover
