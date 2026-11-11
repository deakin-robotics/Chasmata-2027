#include "real_arm_backend.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <unordered_set>

namespace rover
{
namespace
{
using namespace std::chrono_literals;
constexpr std::array<const char *, 6> names{{"base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"}};
}
RealArmBackend::RealArmBackend(rclcpp::Node & node)
{
  const auto values = node.declare_parameter<std::vector<double>>("arm_manual_speed_rpm", std::vector<double>(6, 0.0));
  if (values.size() != names.size() || std::any_of(values.begin(), values.end(), [](double v) { return !std::isfinite(v) || v <= 0.0; }))
    throw std::invalid_argument("arm_manual_speed_rpm must contain six positive finite RPM values");
  std::copy(values.begin(), values.end(), speeds_.begin());
  command_ = node.create_publisher<dcr_arm_driver::msg::DirectDrive>("/arm/direct_drive", rclcpp::QoS(32));
  status_sub_ = node.create_subscription<Status>("/arm/control/status", rclcpp::QoS(10).reliable(),
    [this](const Status & status) { on_status(status); });
  joy_sub_ = node.create_subscription<sensor_msgs::msg::Joy>("/arm/joy", 10,
    [this](const sensor_msgs::msg::Joy & joy) { on_joy(joy); });
  timer_ = node.create_wall_timer(50ms, [this] { tick(); });
}
bool RealArmBackend::ready() const
{
  const auto n = status_.joint_names.size();
  if (Clock::now() - status_time_ > 300ms || !status_.direct_ready || n == 0 || n > names.size() ||
      status_.joint_can_ids.size() != n || status_.joint_max_velocity_rpm.size() != n || status_.direct_request_ids.size() != n) return false;
  std::unordered_set<std::string> unique_names;
  std::unordered_set<uint32_t> unique_ids;
  for (size_t i = 0; i < n; ++i) {
    auto found = std::find_if(names.begin(), names.end(), [&](const char * name) { return status_.joint_names[i] == name; });
    if (found == names.end() || !unique_names.insert(status_.joint_names[i]).second ||
        !unique_ids.insert(status_.joint_can_ids[i]).second || status_.joint_can_ids[i] == 0 ||
        !std::isfinite(status_.joint_max_velocity_rpm[i]) || speeds_[found - names.begin()] > status_.joint_max_velocity_rpm[i]) return false;
  }
  return true;
}
void RealArmBackend::on_status(const Status & status)
{
  status_ = status;
  status_time_ = Clock::now();
}
void RealArmBackend::on_joy(const sensor_msgs::msg::Joy & joy)
{
  if (joy.axes.size() < 10 || joy.buttons.size() <= 4 ||
      std::any_of(joy.axes.begin(), joy.axes.end(), [](float a) { return !std::isfinite(a) || a < -1.0 || a > 1.0; }) ||
      joy.axes[8] < 0 || joy.axes[9] < 0 ||
      std::any_of(joy.buttons.begin(), joy.buttons.end(), [](int b) { return b != 0 && b != 1; })) return;
  axes_ = {joy.axes[0], joy.axes[1], joy.buttons[4] ? 0.0 : joy.axes[4], joy.axes[6], joy.axes[7], joy.axes[9] - joy.axes[8]};
  joy_time_ = Clock::now();
}
void RealArmBackend::request_mode(const std::string & mode)
{
  result_.reset();
  if (mode != "MANUAL") { pending_ = false; result_ = false; return; }
  if (valid_ && ready()) { result_ = true; return; }
  pending_ = true;
  valid_ = false;
  sending_ = false;
  joy_time_ = {};
  deadline_ = Clock::now() + 2s;
  request_id_ = static_cast<uint64_t>(Clock::now().time_since_epoch().count());
  if (request_id_ == 0) ++request_id_;
}
void RealArmBackend::cancel_mode_request()
{
  if (pending_) { if (sending_) send(true); sending_ = false; }
  pending_ = false; result_.reset();
}
std::optional<bool> RealArmBackend::take_mode_result()
{
  auto result = result_; result_.reset(); return result;
}
void RealArmBackend::send(bool neutral)
{
  for (size_t i = 0; i < status_.joint_names.size(); ++i) {
    const auto found = std::find_if(names.begin(), names.end(), [&](const char * name) { return status_.joint_names[i] == name; });
    if (found == names.end() || i >= status_.joint_can_ids.size()) continue;
    const auto index = static_cast<size_t>(found - names.begin());
    dcr_arm_driver::msg::DirectDrive msg;
    msg.id = status_.joint_can_ids[i]; msg.mode = dcr_arm_driver::msg::DirectDrive::SPEED;
    msg.value = neutral ? 0.0 : axes_[index] * speeds_[index]; msg.request_id = request_id_;
    command_->publish(msg);
  }
}
void RealArmBackend::fail()
{
  if (sending_) send(true);
  sending_ = false; valid_ = false;
  if (pending_) result_ = false;
  pending_ = false;
}
void RealArmBackend::tick()
{
  if (!pending_ && !valid_) return;
  if (!ready()) {
    if (valid_ || sending_ || Clock::now() >= deadline_) fail();
    return;
  }
  if (pending_) {
    if (Clock::now() >= deadline_) { fail(); return; }
    if (sending_ && std::all_of(status_.direct_request_ids.begin(), status_.direct_request_ids.end(),
        [this](uint64_t id) { return id == request_id_; })) {
      valid_ = true; pending_ = false; result_ = true; joy_time_ = {};
    }
    sending_ = true;
    send(true);
    return;
  }
  if (!std::all_of(status_.direct_request_ids.begin(), status_.direct_request_ids.end(),
      [this](uint64_t id) { return id == request_id_; })) { fail(); return; }
  send(Clock::now() - joy_time_ > 250ms);
}
}
