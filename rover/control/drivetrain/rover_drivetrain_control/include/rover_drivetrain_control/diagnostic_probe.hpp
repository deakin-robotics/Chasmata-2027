#ifndef ROVER_DRIVETRAIN_CONTROL__DIAGNOSTIC_PROBE_HPP_
#define ROVER_DRIVETRAIN_CONTROL__DIAGNOSTIC_PROBE_HPP_

#include "rover_drivetrain_control/bld305s_driver.hpp"

#include <cstdint>
#include <optional>
#include <string>

namespace rover_drivetrain_control::diagnostics
{

// Read-only selectors for the ReadMotorDiagnostic service. Every entry is a
// function code 03 read; there is deliberately no write path in this table.
// Register meanings: docs/BLD305S_REGISTERS.md (manual-cited, not bench-verified).
struct ProbeSelector
{
  std::uint8_t selector;
  std::uint16_t register_address;  // for logs and tests; the driver owns the wire address
  const char * name;
  Bld305sDriver::Result (Bld305sDriver::*read)(std::uint8_t, std::uint16_t &);
};

struct ProbeRead
{
  Bld305sDriver::Result result{};
  std::uint16_t raw_value{0};
  std::string detail;
};

// Returns nullptr for any selector other than 1..8.
[[nodiscard]] const ProbeSelector * findProbeSelector(std::uint8_t selector) noexcept;

// std::nullopt means the selector was rejected and nothing was sent.
[[nodiscard]] std::optional<ProbeRead> readProbe(
  Bld305sDriver & driver, std::uint8_t slave_id, std::uint8_t selector);

// Manual meaning of a raw value as a log string. Never converts units.
[[nodiscard]] std::string describeRaw(
  const ProbeSelector & selector, std::uint8_t slave_id, std::uint16_t raw_value);

}  // namespace rover_drivetrain_control::diagnostics

#endif  // ROVER_DRIVETRAIN_CONTROL__DIAGNOSTIC_PROBE_HPP_
