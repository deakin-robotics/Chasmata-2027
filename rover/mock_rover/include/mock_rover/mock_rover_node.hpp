#pragma once

#include <memory>

#include <rclcpp/node.hpp>

namespace mock_rover
{
std::shared_ptr<rclcpp::Node> make_mock_rover_node();
}  // namespace mock_rover
