#include "rover_drivetrain_control/bld305s_driver.hpp"
#include <modbus/modbus.h>
#include <array>
#include <stdexcept>
#define CHECK(e) do { if (!(e)) throw std::runtime_error(#e); } while(false)
#include <cerrno>
#include <cstdint>
#include <iostream>

struct _modbus {
  int slave{0};
  bool connected{false};
};

static _modbus * shared_context{nullptr};
static unsigned contexts_created{0};
static std::array<bool, 5> fail_slave{};
static std::array<unsigned, 5> read_attempts{};
extern "C" {
modbus_t * modbus_new_rtu(const char *, int, char, int, int)
{
  CHECK(shared_context == nullptr);
  ++contexts_created;
  shared_context = new _modbus;
  return shared_context;
}
int modbus_set_response_timeout(modbus_t *, std::uint32_t, std::uint32_t) {return 0;}
int modbus_connect(modbus_t * m) {m->connected=true;return 0;}
void modbus_close(modbus_t * m) {m->connected=false;}
void modbus_free(modbus_t * m) {CHECK(m==shared_context);delete m;shared_context=nullptr;}
int modbus_set_slave(modbus_t * m, int slave)
{
  CHECK(m==shared_context && m->connected);
  CHECK(slave>=1 && slave<=4);
  m->slave=slave;
  return 0;
}
int modbus_read_registers(modbus_t * m, int, int n, std::uint16_t * out)
{
  CHECK(m==shared_context && m->connected);
  ++read_attempts[m->slave];
  if (fail_slave[m->slave]) {errno=ETIMEDOUT;return -1;}
  *out=static_cast<std::uint16_t>(100+m->slave);
  return n;
}
int modbus_write_register(modbus_t * m, int, const std::uint16_t)
{
  CHECK(m==shared_context && m->connected);
  if (fail_slave[m->slave]) {errno=ETIMEDOUT;return -1;}
  return 1;
}
}

int main()
{
  using Driver = rover_drivetrain_control::Bld305sDriver;
  const Driver::SlaveIds ids{1,2,3,4};
  Driver::RtuConfig cfg;
  cfg.device="mock"; cfg.baud_rate=38400; cfg.parity='N';
  cfg.data_bits=8; cfg.stop_bits=1;
  Driver driver(cfg);
  CHECK(driver.open().ok());
  CHECK(contexts_created==1);
  CHECK(driver.beginCycle({1,2,3,3}).code==Driver::ErrorCode::INVALID_CYCLE_STATE);
  CHECK(driver.beginCycle({0,2,3,4}).code==Driver::ErrorCode::INVALID_CYCLE_STATE);
  CHECK(driver.beginCycle({1,2,3,248}).code==Driver::ErrorCode::INVALID_CYCLE_STATE);
  CHECK(!driver.allSlavesLost({1,2,3,3}));

  std::uint16_t value=0;
  auto read_good = [&](std::uint8_t id) {
      CHECK(driver.readTemperatureRaw(id,value).ok());
      CHECK(value==100+id);  // verifies the selected slave for each transaction
      CHECK(driver.readCurrentRaw(id,value).ok());
      CHECK(driver.readVoltageRaw(id,value).ok());
    };
  // One timeout skips only the failed slave; all three peers stay healthy.
  fail_slave[1]=true;
  for (unsigned cycle=1;cycle<=3;++cycle) {
    CHECK(driver.beginCycle(ids).ok());
    CHECK(driver.beginCycle(ids).code==Driver::ErrorCode::INVALID_CYCLE_STATE);
    const auto before=read_attempts[1];
    CHECK(!driver.readTemperatureRaw(1,value).ok());
    CHECK(driver.readCurrentRaw(1,value).code==Driver::ErrorCode::SKIPPED_THIS_CYCLE);
    CHECK(driver.writeSpeedRaw(1,0).code==Driver::ErrorCode::SKIPPED_THIS_CYCLE);
    CHECK(read_attempts[1]==before+1);
    for (std::uint8_t id=2;id<=4;++id) read_good(id);
    CHECK(driver.endCycle().ok());
    CHECK(driver.consecutiveFailures(1)==cycle);
    CHECK(!driver.telemetryValid(1));
    CHECK(!driver.allSlavesLost(ids));
    for (std::uint8_t id=2;id<=4;++id) {
      CHECK(driver.consecutiveFailures(id)==0);
      CHECK(driver.communicationState(id)==Driver::CommunicationState::HEALTHY);
      CHECK(driver.telemetryValid(id));
    }
  }
  CHECK(driver.communicationState(1)==Driver::CommunicationState::LOST);
  CHECK(driver.controllerState(1)==Driver::ControllerState::UNKNOWN);
  fail_slave[1]=false;
  CHECK(driver.beginCycle({4,2,1,3}).ok());  // wheel mapping order is configurable
  for (auto id : ids) read_good(id);
  CHECK(driver.endCycle().ok());
  CHECK(driver.telemetryValid(1));
  CHECK(driver.communicationState(1)==Driver::CommunicationState::HEALTHY);
  CHECK(driver.controllerState(1)==Driver::ControllerState::UNKNOWN);

  // Exercise failures for a drive that used to be on the other adapter.
  fail_slave[3]=true;
  for (unsigned cycle=1;cycle<=3;++cycle) {
    CHECK(driver.beginCycle(ids).ok());
    for (auto id : ids) {
      if (id==3) {
        CHECK(!driver.readTemperatureRaw(id,value).ok());
        CHECK(driver.readCurrentRaw(id,value).code==Driver::ErrorCode::SKIPPED_THIS_CYCLE);
      } else {
        read_good(id);
      }
    }
    CHECK(driver.endCycle().ok());
    CHECK(driver.consecutiveFailures(3)==cycle);
    CHECK(driver.telemetryValid(3)==(cycle==1));
    CHECK(driver.communicationState(3)==(cycle<3 ?
      Driver::CommunicationState::DEGRADED : Driver::CommunicationState::LOST));
    CHECK(!driver.allSlavesLost(ids));
  }

  // Missing work for any of the four drives counts as a missed cycle.
  fail_slave[3]=false;
  CHECK(driver.beginCycle(ids).ok());
  for (std::uint8_t id=1;id<=3;++id) read_good(id);
  CHECK(driver.endCycle().ok());
  CHECK(driver.consecutiveFailures(4)==1);
  CHECK(driver.communicationState(4)==Driver::CommunicationState::DEGRADED);

  // Correlated silence requires all four drives, not just one side.
  for (auto id : ids) fail_slave[id]=true;
  for (int cycle=0;cycle<3;++cycle) {
    CHECK(driver.beginCycle(ids).ok());
    for (auto id : ids) CHECK(!driver.readTemperatureRaw(id,value).ok());
    CHECK(driver.endCycle().ok());
  }
  CHECK(driver.allSlavesLost(ids));
  CHECK(contexts_created==1);
  driver.close();
  CHECK(shared_context==nullptr);
  std::cout<<"mock shared-bus four-drive per-cycle tests passed\n";
}
