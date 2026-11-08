#pragma once

#include <memory>

#include <rclcpp/node.hpp>

namespace mock_rover
{
class DriveBackend;
std::shared_ptr<rclcpp::Node> make_mock_rover_node();
std::shared_ptr<rclcpp::Node> make_mock_rover_node(std::unique_ptr<DriveBackend> drive_backend);
}  // namespace mock_rover
