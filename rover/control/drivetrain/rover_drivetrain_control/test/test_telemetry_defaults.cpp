// An unpopulated telemetry message must never read as a working motor: no
// successful communication, no valid measurement, no successful command.
#include "rover_drivetrain_interfaces/msg/drivetrain_telemetry.hpp"
#include "rover_drivetrain_interfaces/msg/wheel_telemetry.hpp"
#include <stdexcept>
#define CHECK(e) do { if (!(e)) throw std::runtime_error(#e); } while(false)
#include <iostream>
using rover_drivetrain_interfaces::msg::DrivetrainTelemetry;
using rover_drivetrain_interfaces::msg::WheelTelemetry;
int main()
{
  // Zero must mean "unknown"/"not attempted", never success.
  CHECK(WheelTelemetry::RESULT_NOT_ATTEMPTED == 0);
  CHECK(WheelTelemetry::RESULT_ACKNOWLEDGED != 0);
  CHECK(WheelTelemetry::COMM_UNKNOWN == 0);
  CHECK(WheelTelemetry::COMM_HEALTHY != 0);
  CHECK(WheelTelemetry::DIRECTION_UNKNOWN == 0);

  const WheelTelemetry w;
  // Commanded: nothing known to have been commanded. Speed values default to
  // 0.0 (rosidl cannot default to NaN), so the validity flags are the guard.
  CHECK(!w.commanded_valid);
  CHECK(!w.commanded_raw_valid);
  CHECK(w.commanded_direction == WheelTelemetry::DIRECTION_UNKNOWN);
  // Measured: nothing valid.
  CHECK(!w.measured_speed_valid);
  CHECK(w.measured_direction == WheelTelemetry::DIRECTION_UNKNOWN);
  CHECK(!w.measured_raw_speed_valid);
  CHECK(!w.raw_fault_valid && !w.raw_temperature_valid);
  CHECK(!w.raw_current_valid && !w.raw_voltage_valid);
  // Communication: nothing sent, nothing acknowledged, health unknown.
  CHECK(w.last_write_result == WheelTelemetry::RESULT_NOT_ATTEMPTED);
  CHECK(w.last_read_result == WheelTelemetry::RESULT_NOT_ATTEMPTED);
  CHECK(w.comm_state == WheelTelemetry::COMM_UNKNOWN);

  const DrivetrainTelemetry d;
  CHECK(!d.hardware_active);
  CHECK(d.wheels.empty());
  std::cout << "telemetry default tests passed\n";
}
