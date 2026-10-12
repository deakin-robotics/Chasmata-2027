#include "rover_drivetrain_control/drivetrain_core.hpp"
#include <cassert>
#include <stdexcept>
#define CHECK(e) do { if (!(e)) throw std::runtime_error(#e); } while(false)
#include <cmath>
#include <iostream>
#include <limits>
using namespace rover_drivetrain_control::core;
int main()
{
  WheelCycleHealth a, b;
  a.finishCycle(false); a.finishCycle(false);
  CHECK(!a.valid && !a.lost && a.missed_cycles == 2);
  b.finishCycle(true);
  CHECK(b.valid && !b.lost && b.missed_cycles == 0);
  a.finishCycle(false);
  CHECK(a.lost && a.missed_cycles == 3);
  a.finishCycle(true);
  CHECK(a.valid && !a.lost && a.missed_cycles == 0);
  MotorSetpoint m;
  CHECK(translateWheelSpeed(1.0, 50.0, false, 2000, m).ok && m.direction == 1);
  CHECK(translateWheelSpeed(1.0, 50.0, true, 2000, m).ok && m.direction == 2);
  CHECK(!translateWheelSpeed(std::numeric_limits<double>::quiet_NaN(), 50, false, 2000, m).ok);
  TimingConfig t{15.0, 110.0, 250.0, 5.0, 30.0, 100.0};
  CHECK(validateTiming(t).ok); // 110 + 133.33 + 5 = 248.33 ms
  t.worst_bus_cycle_ms = 40.0;
  CHECK(!validateTiming(t).ok);
  t.worst_bus_cycle_ms = 30.0;
  CHECK(validateTiming(t).ok);
  CHECK(lateTrigger(1000000000LL, 1200000000LL, 100.0));
  CHECK(!lateTrigger(1000000000LL, 1050000000LL, 100.0));
  std::cout << "core tests passed\n";
}
