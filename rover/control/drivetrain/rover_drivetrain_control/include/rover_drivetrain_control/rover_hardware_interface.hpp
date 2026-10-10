#ifndef ROVER_DRIVETRAIN_CONTROL__ROVER_HARDWARE_INTERFACE_HPP_
#define ROVER_DRIVETRAIN_CONTROL__ROVER_HARDWARE_INTERFACE_HPP_

#include "rover_drivetrain_control/bld305s_driver.hpp"

#include <hardware_interface/hardware_info.hpp>
#include <hardware_interface/system_interface.hpp>
#include <hardware_interface/types/hardware_interface_return_values.hpp>

#include <rclcpp/duration.hpp>
#include <rclcpp/time.hpp>
#include <rclcpp_lifecycle/state.hpp>

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace rover_drivetrain_control
{

class RoverHardwareInterface : public hardware_interface::SystemInterface
{
public:
  static constexpr std::size_t WHEEL_COUNT = 4;
  static constexpr std::size_t BUS_COUNT = 2;

  enum class BusId : std::uint8_t
  {
    LEFT = 0,
    RIGHT = 1
  };

  struct WheelConfig
  {
    std::string joint_name;
    BusId bus{BusId::LEFT};
    std::uint8_t slave_id{0};
  };

  RoverHardwareInterface() = default;
  ~RoverHardwareInterface() override = default;

  RoverHardwareInterface(const RoverHardwareInterface &) = delete;
  RoverHardwareInterface & operator=(const RoverHardwareInterface &) = delete;
  RoverHardwareInterface(RoverHardwareInterface &&) = delete;
  RoverHardwareInterface & operator=(RoverHardwareInterface &&) = delete;

  hardware_interface::CallbackReturn on_init(
    const hardware_interface::HardwareInfo & info) override;

  hardware_interface::CallbackReturn on_configure(
    const rclcpp_lifecycle::State & previous_state) override;

  hardware_interface::CallbackReturn on_activate(
    const rclcpp_lifecycle::State & previous_state) override;

  hardware_interface::CallbackReturn on_deactivate(
    const rclcpp_lifecycle::State & previous_state) override;

  hardware_interface::CallbackReturn on_cleanup(
    const rclcpp_lifecycle::State & previous_state) override;

  std::vector<hardware_interface::StateInterface>
  export_state_interfaces() override;

  std::vector<hardware_interface::CommandInterface>
  export_command_interfaces() override;

  hardware_interface::return_type read(
    const rclcpp::Time & time,
    const rclcpp::Duration & period) override;

  hardware_interface::return_type write(
    const rclcpp::Time & time,
    const rclcpp::Duration & period) override;

  [[nodiscard]] std::int64_t lastIoHeartbeatNs() const noexcept;

private:
  [[nodiscard]] bool parseConfiguration();
  [[nodiscard]] bool parseWheelConfiguration(std::size_t wheel_index);
  [[nodiscard]] bool validateWheelMapping() const;

  [[nodiscard]] static bool parseBusId(
    const std::string & value,
    BusId & bus);

  [[nodiscard]] static constexpr std::size_t busIndex(
    BusId bus) noexcept
  {
    return static_cast<std::size_t>(bus);
  }

  [[nodiscard]] Bld305sDriver * driverForWheel(
    std::size_t wheel_index) noexcept;

  [[nodiscard]] const Bld305sDriver * driverForWheel(
    std::size_t wheel_index) const noexcept;

  void updateIoHeartbeat() noexcept;
  [[nodiscard]] static std::int64_t steadyNowNs() noexcept;
  void resetInterfaceStorage() noexcept;
  void closeDrivers() noexcept;

  hardware_interface::HardwareInfo hardware_info_{};

  std::array<WheelConfig, WHEEL_COUNT> wheels_{};
  std::array<std::unique_ptr<Bld305sDriver>, BUS_COUNT> drivers_{};
  std::array<Bld305sDriver::RtuConfig, BUS_COUNT> bus_configs_{};

  std::array<double, WHEEL_COUNT> command_velocity_rad_s_{};
  std::array<double, WHEEL_COUNT> state_velocity_rad_s_{};

  std::array<std::uint16_t, WHEEL_COUNT> raw_speed_state_{};
  std::array<bool, WHEEL_COUNT> raw_speed_state_valid_{};

  std::array<Bld305sDriver::CommunicationState, WHEEL_COUNT>
    communication_state_{};

  std::array<Bld305sDriver::ControllerState, WHEEL_COUNT>
    controller_state_{};

  std::atomic<std::int64_t> last_io_heartbeat_ns_{0};

  std::atomic<bool> read_blocked_logged_{false};
  std::atomic<bool> write_blocked_logged_{false};

  bool configuration_valid_{false};
  bool transports_open_{false};
  bool operationally_ready_{false};
  bool active_{false};
};

}  // namespace rover_drivetrain_control

#endif  // ROVER_DRIVETRAIN_CONTROL__ROVER_HARDWARE_INTERFACE_HPP_
