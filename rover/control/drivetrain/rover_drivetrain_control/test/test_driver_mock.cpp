#include "rover_drivetrain_control/bld305s_driver.hpp"
#include <modbus/modbus.h>
#include <cassert>
#include <stdexcept>
#define CHECK(e) do { if (!(e)) throw std::runtime_error(#e); } while(false)
#include <cerrno>
#include <cstdint>
#include <iostream>
#include <memory>
#include <string>

struct _modbus {
  int slave{0};
  bool connected{false};
};

static bool fail_one{false};
extern "C" {
modbus_t * modbus_new_rtu(const char *, int, char, int, int) {return new _modbus;}
int modbus_set_response_timeout(modbus_t *, std::uint32_t, std::uint32_t) {return 0;}
int modbus_connect(modbus_t * m) {m->connected=true;return 0;}
void modbus_close(modbus_t * m) {m->connected=false;}
void modbus_free(modbus_t * m) {delete m;}
int modbus_set_slave(modbus_t * m, int slave) {m->slave=slave;return 0;}
int modbus_read_registers(modbus_t * m, int, int n, std::uint16_t * out)
{
  if (m->slave==1 && fail_one) {errno=ETIMEDOUT;return -1;}
  *out=123;return n;
}
int modbus_write_register(modbus_t * m, int, const std::uint16_t)
{
  if (m->slave==1 && fail_one) {errno=ETIMEDOUT;return -1;}
  return 1;
}
}

int main()
{
  using Driver = rover_drivetrain_control::Bld305sDriver;
  Driver::RtuConfig cfg;
  cfg.device="mock"; cfg.baud_rate=38400; cfg.parity='N';
  cfg.data_bits=8; cfg.stop_bits=1;
  Driver driver(cfg);
  CHECK(driver.open().ok());
  std::uint16_t value=0;
  for (int cycle=1;cycle<=3;++cycle) {
    CHECK(driver.beginCycle(1,2).ok());
    fail_one=true;
    CHECK(!driver.readTemperatureRaw(1,value).ok());
    const auto skipped=driver.readCurrentRaw(1,value);
    CHECK(skipped.code==Driver::ErrorCode::SKIPPED_THIS_CYCLE);
    fail_one=false;
    CHECK(driver.readTemperatureRaw(2,value).ok());
    CHECK(driver.readCurrentRaw(2,value).ok());
    CHECK(driver.readVoltageRaw(2,value).ok());
    CHECK(driver.endCycle().ok());
    CHECK(driver.consecutiveFailures(1)==static_cast<unsigned>(cycle));
    CHECK(driver.consecutiveFailures(2)==0);
    CHECK(driver.communicationState(2)==Driver::CommunicationState::HEALTHY);
    CHECK(driver.telemetryValid(2));
    CHECK(!driver.telemetryValid(1));
    CHECK(!driver.bothSlavesLost(1, 2));
  }
  CHECK(driver.communicationState(1)==Driver::CommunicationState::LOST);
  CHECK(driver.controllerState(1)==Driver::ControllerState::UNKNOWN);
  CHECK(driver.beginCycle(1,2).ok());
  CHECK(driver.readTemperatureRaw(1,value).ok());
  CHECK(driver.readCurrentRaw(1,value).ok());
  CHECK(driver.readVoltageRaw(1,value).ok());
  CHECK(driver.readTemperatureRaw(2,value).ok());
  CHECK(driver.readCurrentRaw(2,value).ok());
  CHECK(driver.readVoltageRaw(2,value).ok());
  CHECK(driver.endCycle().ok());
  CHECK(driver.communicationState(1)==Driver::CommunicationState::HEALTHY);
  CHECK(driver.telemetryValid(1));
  CHECK(driver.controllerState(1)==Driver::ControllerState::UNKNOWN);
  // After a good cycle: DEGRADED, not LOST, for one and two failed cycles, and
  // the good data stays valid for exactly one missed cycle (AD-15 grace).
  for (int cycle=1;cycle<=2;++cycle) {
    CHECK(driver.beginCycle(1,2).ok());
    fail_one=true;
    CHECK(!driver.readTemperatureRaw(1,value).ok());
    fail_one=false;
    CHECK(driver.readTemperatureRaw(2,value).ok());
    CHECK(driver.readCurrentRaw(2,value).ok());
    CHECK(driver.readVoltageRaw(2,value).ok());
    CHECK(driver.endCycle().ok());
    CHECK(driver.consecutiveFailures(1)==static_cast<unsigned>(cycle));
    CHECK(driver.communicationState(1)==Driver::CommunicationState::DEGRADED);
    CHECK(driver.telemetryValid(1)==(cycle==1));
    CHECK(driver.communicationState(2)==Driver::CommunicationState::HEALTHY);
  }
  driver.close();
  std::cout<<"mock libmodbus driver per-cycle tests passed\n";
}
