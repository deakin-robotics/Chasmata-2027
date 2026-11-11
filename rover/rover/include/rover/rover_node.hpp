#pragma once

#include <memory>

#include <rclcpp/node.hpp>

namespace rover
{
class DriveBackend;
std::shared_ptr<rclcpp::Node> make_rover_node();
std::shared_ptr<rclcpp::Node> make_rover_node(std::unique_ptr<DriveBackend> drive_backend);
}  // namespace rover
