// Standalone end effector driver for the DCR arm.
//
// Unlike dcr_arm_driver, this node does NOT use ros2_control. It is a plain
// rclcpp node that:
//   * subscribes to arm_interfaces/msg/EeCommand on a dedicated topic
//     (default: /ee_command)
//   * translates the command into a raw CAN frame and publishes it to the
//     nobleo_socketcan_bridge output topic /socketcan_bridge/tx
//
// The CAN protocol matches the old motor_node implementation:
//   ID 0x07, DLC 0x02
//     0xA0 -> speed control      (data[1] = speed)
//     0xA1 -> position control   (data[1] = position)
//     0xA2 -> laser control      (data[1] = 0x00)

#include <atomic>
#include <chrono>
#include <csignal>
#include <memory>
#include <mutex>
#include <thread>

#include "rclcpp/rclcpp.hpp"
#include "can_msgs/msg/frame.hpp"
#include "arm_interfaces/msg/ee_command.hpp"
#include "std_msgs/msg/bool.hpp"

namespace dcr_ee_driver {

class EeDriverNode : public rclcpp::Node {
 public:
  EeDriverNode() : rclcpp::Node("ee_driver_node") {
    // Topic the outgoing CAN frames are published on. This is the tx topic of
    // nobleo_socketcan_bridge (node "socketcan_bridge", private topic "~/tx").
    can_tx_topic_ =
        this->declare_parameter<std::string>("can_tx_topic", "/socketcan_bridge/tx");
    command_topic_ =
        this->declare_parameter<std::string>("command_topic", "/ee_command");
    estop_topic_ =
        this->declare_parameter<std::string>("estop_topic", "/estop");
    ee_can_id_ = this->declare_parameter<int>("ee_can_id", 0x07);

    can_pub_ = this->create_publisher<can_msgs::msg::Frame>(
        can_tx_topic_, rclcpp::QoS(100));

    command_sub_ = this->create_subscription<arm_interfaces::msg::EeCommand>(
        command_topic_, rclcpp::QoS(10),
        [this](const arm_interfaces::msg::EeCommand& msg) {
          this->on_command(msg);
        });
    estop_sub_ = this->create_subscription<std_msgs::msg::Bool>(
        estop_topic_, rclcpp::QoS(1),
        [this](const std_msgs::msg::Bool& msg) { this->on_estop(msg); });

    RCLCPP_INFO(this->get_logger(),
                "EE driver ready. cmd topic='%s', E-stop topic='%s', CAN tx=%s, CAN ID=0x%02X",
                command_topic_.c_str(), estop_topic_.c_str(), can_tx_topic_.c_str(),
                static_cast<unsigned int>(ee_can_id_));
  }

  void stop_motion() {
    std::lock_guard<std::mutex> lock(command_mutex_);
    if (stopping_) {
      return;
    }
    stopping_ = true;
    publish_zero_speed();
    RCLCPP_INFO(this->get_logger(), "Sent end-effector zero-speed command before shutdown");
  }

 private:
  void on_command(const arm_interfaces::msg::EeCommand& msg) {
    std::lock_guard<std::mutex> lock(command_mutex_);
    if (stopping_ || estop_asserted_.load(std::memory_order_relaxed)) {
      RCLCPP_WARN(this->get_logger(),
                  "Ignoring end-effector command while E-stop is asserted or driver is stopping");
      return;
    }

    can_msgs::msg::Frame frame;
    frame.id = static_cast<uint32_t>(ee_can_id_);
    frame.dlc = 0x02;

    switch (msg.command) {
      case arm_interfaces::msg::EeCommand::CMD_SPEED:
        frame.data[0] = 0xA0;
        frame.data[1] = msg.value;
        break;
      case arm_interfaces::msg::EeCommand::CMD_POSITION:
        frame.data[0] = 0xA1;
        frame.data[1] = msg.value;
        break;
      case arm_interfaces::msg::EeCommand::CMD_LASER:
        frame.data[0] = 0xA2;
        frame.data[1] = 0x00;
        break;
      default:
        RCLCPP_WARN(this->get_logger(), "Unknown EE command %u, ignoring",
                    static_cast<unsigned int>(msg.command));
        return;
    }

    can_pub_->publish(frame);
    RCLCPP_DEBUG(this->get_logger(), "Sent EE CAN cmd 0x%02X value %u",
                 frame.data[0], static_cast<unsigned int>(frame.data[1]));
  }

  void on_estop(const std_msgs::msg::Bool& msg) {
    std::lock_guard<std::mutex> lock(command_mutex_);
    estop_asserted_.store(msg.data, std::memory_order_relaxed);
    if (!msg.data) {
      return;
    }

    publish_zero_speed();
    RCLCPP_WARN(this->get_logger(), "E-stop asserted; sent end-effector zero-speed command");
  }

  void publish_zero_speed() {
    can_msgs::msg::Frame stop_frame;
    stop_frame.id = static_cast<uint32_t>(ee_can_id_);
    stop_frame.dlc = 0x02;
    stop_frame.data[0] = 0xA0;
    stop_frame.data[1] = 0x00;
    can_pub_->publish(stop_frame);
  }

  std::string can_tx_topic_;
  std::string command_topic_;
  std::string estop_topic_;
  int ee_can_id_;
  std::atomic<bool> estop_asserted_{false};
  std::mutex command_mutex_;
  bool stopping_{false};
  rclcpp::Publisher<can_msgs::msg::Frame>::SharedPtr can_pub_;
  rclcpp::Subscription<arm_interfaces::msg::EeCommand>::SharedPtr command_sub_;
  rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr estop_sub_;
};

}  // namespace dcr_ee_driver

namespace {
volatile std::sig_atomic_t shutdown_requested = 0;

void handle_shutdown_signal(int /*signal*/) { shutdown_requested = 1; }
}  // namespace

int main(int argc, char** argv) {
  rclcpp::init(argc, argv, rclcpp::InitOptions(),
               rclcpp::SignalHandlerOptions::None);
  std::signal(SIGINT, handle_shutdown_signal);
  std::signal(SIGTERM, handle_shutdown_signal);

  auto node = std::make_shared<dcr_ee_driver::EeDriverNode>();
  rclcpp::executors::SingleThreadedExecutor executor;
  executor.add_node(node);
  while (rclcpp::ok() && !shutdown_requested) {
    executor.spin_some();
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }

  // Publish while the ROS context and CAN publisher are still alive, then
  // leave a short window for the bridge to transmit the final frame.
  node->stop_motion();
  std::this_thread::sleep_for(std::chrono::milliseconds(100));
  executor.remove_node(node);
  rclcpp::shutdown();
  return 0;
}
