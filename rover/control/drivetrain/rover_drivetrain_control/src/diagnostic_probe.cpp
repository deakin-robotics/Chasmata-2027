#include "rover_drivetrain_control/diagnostic_probe.hpp"

#include <array>
#include <cstdio>

namespace rover_drivetrain_control::diagnostics
{

namespace
{

using Driver = Bld305sDriver;

constexpr std::array<ProbeSelector, 8> SELECTORS{{
  {1, 0x0096, "driver internal temperature", &Driver::readTemperatureRaw},
  {2, 0x00B6, "actual motor current", &Driver::readCurrentRaw},
  {3, 0x00C6, "actual motor voltage", &Driver::readVoltageRaw},
  {4, 0x00A6, "drive address", &Driver::readDriveAddressRaw},
  {5, 0x00F6, "baud code", &Driver::readBaudCodeRaw},
  {6, 0x0076, "fault code", &Driver::readFaultRaw},
  {7, 0x0066, "running status", &Driver::readRunningStatusRaw},
  {8, 0x005F, "actual motor speed", &Driver::readActualSpeedRaw},
}};

// Baud codes as listed in the manual's 0x00F6 table.
const char * baudCodeMeaning(std::uint16_t code)
{
  switch (code) {
    case 0x00: return "4800";
    case 0x01: return "9600";
    case 0x02: return "14400";
    case 0x03: return "19200";
    case 0x04: return "38400";
    case 0x05: return "56000";
    case 0x06: return "57600";
    case 0x07: return "115200";
    case 0x08: return "128000";
    case 0x09: return "230400";
    case 0x10: return "256000";
    default: return nullptr;
  }
}

const char * faultMeaning(std::uint16_t code)
{
  switch (code) {
    case 1: return "overcurrent";
    case 2: return "over temperature";
    case 3: return "overpressure";
    case 4: return "undervoltage";
    case 5: return "sensor abnormality";
    case 6: return "overspeed";
    case 8: return "stalled";
    case 9: return "peak current";
    default: return nullptr;
  }
}

const char * runningStatusMeaning(std::uint16_t code)
{
  switch (code) {
    case 0: return "stop";
    case 1: return "forward";
    case 2: return "reverse";
    case 3: return "brake";
    default: return nullptr;
  }
}

std::string meaningFor(std::uint8_t selector, std::uint8_t slave_id, std::uint16_t raw)
{
  char buffer[96];
  const char * meaning = nullptr;
  switch (selector) {
    case 4:
      if (raw == slave_id) return "matches requested slave ID";
      std::snprintf(buffer, sizeof(buffer), "differs from requested slave ID %u",
        static_cast<unsigned>(slave_id));
      return buffer;
    case 5:
      meaning = baudCodeMeaning(raw);
      if (!meaning) return "code not listed in manual";
      std::snprintf(buffer, sizeof(buffer), "manual lists this code as %s baud", meaning);
      return buffer;
    case 6:
      meaning = faultMeaning(raw);
      return meaning ? std::string("manual: ") + meaning : "no meaning listed in manual";
    case 7:
      meaning = runningStatusMeaning(raw);
      return meaning ? std::string("manual: ") + meaning : "no meaning listed in manual";
    case 8:
      return "raw; manual pole-pair correction not applied";
    default:
      return "raw counts; manual gives no scaling";
  }
}

}  // namespace

const ProbeSelector * findProbeSelector(std::uint8_t selector) noexcept
{
  for (const auto & entry : SELECTORS) {
    if (entry.selector == selector) return &entry;
  }
  return nullptr;
}

std::optional<ProbeRead> readProbe(
  Bld305sDriver & driver, std::uint8_t slave_id, std::uint8_t selector)
{
  const ProbeSelector * entry = findProbeSelector(selector);
  if (!entry) return std::nullopt;

  ProbeRead out;
  std::uint16_t value = 0;
  out.result = (driver.*(entry->read))(slave_id, value);
  out.raw_value = out.result.ok() ? value : 0;
  out.detail = out.result.ok() ?
    describeRaw(*entry, slave_id, value) :
    "Modbus read failed; inspect transport and configuration";
  return out;
}

std::string describeRaw(
  const ProbeSelector & selector, std::uint8_t slave_id, std::uint16_t raw_value)
{
  char head[96];
  std::snprintf(head, sizeof(head), "Raw read ACK, 0x%04X %s = %u (0x%04X): ",
    static_cast<unsigned>(selector.register_address), selector.name,
    static_cast<unsigned>(raw_value), static_cast<unsigned>(raw_value));
  return std::string(head) + meaningFor(selector.selector, slave_id, raw_value) +
         ". Manual-cited, bench check pending; no unit conversion.";
}

}  // namespace rover_drivetrain_control::diagnostics
