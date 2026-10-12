#include "rover_drivetrain_control/bld305s_driver.hpp"
#include "rover_drivetrain_interfaces/msg/drivetrain_telemetry.hpp"
#include "rover_drivetrain_interfaces/msg/wheel_telemetry.hpp"
#include "rover_drivetrain_interfaces/srv/read_motor_diagnostic.hpp"
#include <rclcpp/rclcpp.hpp>

#include <chrono>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <string>
#include <utility>

namespace dcr = rover_drivetrain_control;
namespace msg = rover_drivetrain_interfaces::msg;
namespace srv = rover_drivetrain_interfaces::srv;

// Read-only diagnostics. There is deliberately no motor-command service here:
// all motor commands go through ros2_control. Telemetry reports only exchanges
// this node actually performed through the opt-in read probe.
class DrivetrainDiagnosticsNode final : public rclcpp::Node
{
public:
  DrivetrainDiagnosticsNode()
  : Node("drivetrain_diagnostics")
  {
    enable_readonly_ = declare_parameter<bool>("enable_readonly_probe", false);
    RCLCPP_WARN(get_logger(),
      "DIAGNOSTICS ONLY. This node cannot command motors; motor commands go through "
      "ros2_control. Do not run it beside an active drivetrain plugin.");

    telemetry_pub_ = create_publisher<msg::DrivetrainTelemetry>("~/telemetry", 10);
    telemetry_timer_ = create_wall_timer(std::chrono::seconds(1), [this]() {
        msg::DrivetrainTelemetry out;
        out.stamp = now();
        out.hardware_active = false;  // this node is never the ros2_control hardware
        for (const auto & entry : records_) {
          out.wheels.push_back(entry.second);
        }
        telemetry_pub_->publish(out);
      });

    read_service_ = create_service<srv::ReadMotorDiagnostic>(
      "~/read_motor_diagnostic",
      [this](const std::shared_ptr<srv::ReadMotorDiagnostic::Request> request,
             std::shared_ptr<srv::ReadMotorDiagnostic::Response> response) {
        response->success = false;
        response->raw_value = 0;
        response->result_code = 1;
        response->detail = "Read-only probing is disabled (enable_readonly_probe=false).";
        if (!enable_readonly_) return;
        dcr::Bld305sDriver * driver = nullptr;
        if (request->bus == "left") driver = left_.get();
        if (request->bus == "right") driver = right_.get();
        if (!driver || request->address < 1 || request->address > 4) {
          response->result_code = 2;
          response->detail = "Invalid bus, slave ID, or serial connection unavailable";
          return;
        }
        std::uint16_t value = 0;
        dcr::Bld305sDriver::Result result{};
        switch (request->register_selector) {
          case 1: result = driver->readTemperatureRaw(request->address, value); break;
          case 2: result = driver->readCurrentRaw(request->address, value); break;
          case 3: result = driver->readVoltageRaw(request->address, value); break;
          default:
            response->result_code = 2;
            response->detail = "Only selectors 1=temp, 2=current, 3=voltage are permitted";
            return;
        }
        response->success = result.ok();
        response->raw_value = result.ok() ? value : 0;
        response->result_code = result.ok() ? 0 : 3;
        response->detail = result.ok() ?
          "Raw register read ACK (units/scaling and AD-23 bench verification pending)" :
          "Modbus read failed; inspect transport and configuration";
        recordProbe(request->bus, request->address, request->register_selector, result, value,
          response->detail);
      });

    if (enable_readonly_) {
      const auto left_device = declare_parameter<std::string>("left_serial_device", "");
      const auto right_device = declare_parameter<std::string>("right_serial_device", "");
      const auto left_baud = declare_parameter<int>("left_baud_rate", 0);
      const auto right_baud = declare_parameter<int>("right_baud_rate", 0);
      const auto parity = declare_parameter<std::string>("parity", "");
      const auto data_bits = declare_parameter<int>("data_bits", 0);
      const auto stop_bits = declare_parameter<int>("stop_bits", 0);
      const auto timeout_ms = declare_parameter<int>("response_timeout_ms", 30);
      if (left_device.empty() || right_device.empty() || left_device == right_device ||
          left_baud <= 0 || right_baud <= 0 || parity.size() != 1 ||
          (parity != "N" && parity != "E" && parity != "O") ||
          data_bits < 5 || data_bits > 8 || (stop_bits != 1 && stop_bits != 2) ||
          timeout_ms <= 0) {
        RCLCPP_ERROR(get_logger(), "Read-only probe refused: explicit, separate bus devices, positive baud rates and serial framing required.");
        return;
      }
      dcr::Bld305sDriver::RtuConfig config{};
      config.baud_rate = left_baud;
      config.parity = parity[0];
      config.data_bits = data_bits;
      config.stop_bits = stop_bits;
      config.response_timeout = std::chrono::milliseconds(timeout_ms);
      config.device = left_device;
      left_ = std::make_unique<dcr::Bld305sDriver>(config);
      config.device = right_device;
      config.baud_rate = right_baud;
      right_ = std::make_unique<dcr::Bld305sDriver>(config);
      const auto l = left_->open();
      const auto r = right_->open();
      if (!l || !r) {
        RCLCPP_ERROR(get_logger(), "Read-only probe could not open both buses; no motion will be attempted.");
        left_.reset(); right_.reset();
      } else {
        RCLCPP_WARN(get_logger(), "Read-only transports open. A Modbus ACK proves transport, not drive calibration or motion readiness.");
      }
    }
  }

private:
  using ErrorCode = dcr::Bld305sDriver::ErrorCode;

  // Only a reply or a failed wire exchange counts as an attempt; anything the
  // driver refused before sending is reported as REFUSED, not FAILED.
  static std::uint8_t readResultFor(const dcr::Bld305sDriver::Result & result)
  {
    switch (result.code) {
      case ErrorCode::OK: return msg::WheelTelemetry::RESULT_ACKNOWLEDGED;
      case ErrorCode::MODBUS_ERROR:
      case ErrorCode::UNEXPECTED_RETURN_COUNT: return msg::WheelTelemetry::RESULT_FAILED;
      case ErrorCode::SKIPPED_THIS_CYCLE: return msg::WheelTelemetry::RESULT_SKIPPED;
      default: return msg::WheelTelemetry::RESULT_REFUSED;
    }
  }

  void recordProbe(
    const std::string & bus, std::uint8_t address, std::uint8_t selector,
    const dcr::Bld305sDriver::Result & result, std::uint16_t value, const std::string & detail)
  {
    auto inserted = records_.try_emplace(std::make_pair(bus, address));
    msg::WheelTelemetry & wheel = inserted.first->second;
    if (inserted.second) {
      // New record: nothing commanded, nothing measured, nothing written.
      wheel.bus = bus;
      wheel.address = address;
      wheel.commanded_speed_rad_s = std::numeric_limits<double>::quiet_NaN();
      wheel.measured_speed_rad_s = std::numeric_limits<double>::quiet_NaN();
    }
    const bool ok = result.ok();
    switch (selector) {
      case 1: wheel.raw_temperature_valid = ok; wheel.raw_temperature = ok ? value : 0; break;
      case 2: wheel.raw_current_valid = ok; wheel.raw_current = ok ? value : 0; break;
      case 3: wheel.raw_voltage_valid = ok; wheel.raw_voltage = ok ? value : 0; break;
      default: break;
    }
    wheel.last_read_result = readResultFor(result);
    if (!ok) {
      wheel.last_error_code = static_cast<std::uint8_t>(result.code);
    }
    wheel.detail = detail;
    // Raw probe reads run outside 15 Hz cycles, so they say nothing about
    // per-cycle health; comm_state stays UNKNOWN.
  }

  bool enable_readonly_{false};
  std::unique_ptr<dcr::Bld305sDriver> left_;
  std::unique_ptr<dcr::Bld305sDriver> right_;
  std::map<std::pair<std::string, std::uint8_t>, msg::WheelTelemetry> records_;
  rclcpp::Publisher<msg::DrivetrainTelemetry>::SharedPtr telemetry_pub_;
  rclcpp::TimerBase::SharedPtr telemetry_timer_;
  rclcpp::Service<srv::ReadMotorDiagnostic>::SharedPtr read_service_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<DrivetrainDiagnosticsNode>());
  rclcpp::shutdown();
  return 0;
}
