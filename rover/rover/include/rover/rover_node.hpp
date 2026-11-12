#pragma once

#include <memory>

#include <rclcpp/node.hpp>
#include <rclcpp/node_options.hpp>

namespace rover
{
class DriveBackend;
std::shared_ptr<rclcpp::Node> make_rover_node();
std::shared_ptr<rclcpp::Node> make_rover_node(const rclcpp::NodeOptions & options);
std::shared_ptr<rclcpp::Node> make_rover_node(std::unique_ptr<DriveBackend> drive_backend);
}  // namespace rover
