// Direct drive: a second command source INTO ros2_control, never a path
// to the drives. Forwards per-wheel speeds to wheel_velocity_controller and
// sends zeros once commands stop arriving, because a forward_command_controller
// otherwise holds its last command indefinitely.

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>

#include "rclcpp/rclcpp.hpp"
#include "std_msgs/msg/float64_multi_array.hpp"

#include "rover_drivetrain_control/drivetrain_core.hpp"

namespace
{
using std_msgs::msg::Float64MultiArray;
namespace core = rover_drivetrain_control::core;

// Same order as wheel_velocity_controller's joints in drivetrain_controllers.yaml.
constexpr std::size_t WHEEL_COUNT = 4;
// Zeros go out within one period of the timeout expiring.
constexpr std::chrono::milliseconds WATCHDOG_PERIOD{10};

class DirectDriveRelay : public rclcpp::Node
{
public:
  DirectDriveRelay()
  : Node("direct_drive_relay"), steady_clock_(RCL_STEADY_TIME)
  {
    publisher_ = create_publisher<Float64MultiArray>(
      "/drivetrain/wheel_velocity_controller/commands", rclcpp::SystemDefaultsQoS());
    subscription_ = create_subscription<Float64MultiArray>(
      "/drivetrain/direct/wheel_speeds", rclcpp::SystemDefaultsQoS(),
      [this](const Float64MultiArray & msg) {onCommand(msg);});
    timer_ = create_wall_timer(WATCHDOG_PERIOD, [this]() {onWatchdog();});
    RCLCPP_INFO(
      get_logger(),
      "Relaying /drivetrain/direct/wheel_speeds (rad/s: front_left, rear_left, "
      "front_right, rear_right) to wheel_velocity_controller; zeros after %ld ms without a command.",
      static_cast<long>(core::DIRECT_DRIVE_COMMAND_TIMEOUT_NS / 1000000));
  }

private:
  void onCommand(const Float64MultiArray & msg)
  {
    const bool valid = msg.data.size() == WHEEL_COUNT &&
      std::all_of(msg.data.begin(), msg.data.end(), [](double v) {return std::isfinite(v);});
    if (!valid) {
      // A malformed command stops the wheels rather than leaving the last one running.
      RCLCPP_WARN_THROTTLE(
        get_logger(), *get_clock(), 1000,
        "Rejected wheel_speeds: expected %zu finite values, got %zu. Sending zeros.",
        WHEEL_COUNT, msg.data.size());
      last_command_ns_ = 0;
      publishZeros();
      return;
    }
    last_command_ns_ = steady_clock_.now().nanoseconds();
    publisher_->publish(msg);
  }

  void onWatchdog()
  {
    if (!core::directCommandFresh(
        last_command_ns_, steady_clock_.now().nanoseconds(),
        core::DIRECT_DRIVE_COMMAND_TIMEOUT_NS))
    {
      publishZeros();
    }
  }

  void publishZeros()
  {
    Float64MultiArray zeros;
    zeros.data.assign(WHEEL_COUNT, 0.0);
    publisher_->publish(zeros);
  }

  rclcpp::Clock steady_clock_;
  std::int64_t last_command_ns_{0};
  rclcpp::Publisher<Float64MultiArray>::SharedPtr publisher_;
  rclcpp::Subscription<Float64MultiArray>::SharedPtr subscription_;
  rclcpp::TimerBase::SharedPtr timer_;
};

}  // namespace

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<DirectDriveRelay>());
  rclcpp::shutdown();
  return 0;
}
