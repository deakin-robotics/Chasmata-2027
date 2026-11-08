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
  WheelCycleHealth fresh;
  fresh.finishCycle(false);
  CHECK(!fresh.valid && fresh.missed_cycles == 1);  // never valid without a good cycle
  WheelCycleHealth grace;
  grace.finishCycle(true);
  grace.finishCycle(false);
  CHECK(grace.valid && grace.missed_cycles == 1);   // one-cycle grace for good data
  grace.finishCycle(false);
  CHECK(!grace.valid && !grace.lost);
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
  const std::int64_t t0 = 5000000000LL;
  const std::int64_t limit = DIRECT_DRIVE_COMMAND_TIMEOUT_NS;
  CHECK(directCommandFresh(t0, t0, limit));                 // just arrived
  CHECK(directCommandFresh(t0, t0 + 50000000LL, limit));    // fresh: 50 ms old
  CHECK(directCommandFresh(t0, t0 + limit - 1, limit));     // 1 ns inside the limit
  CHECK(!directCommandFresh(t0, t0 + limit, limit));        // exactly 110 ms: stale
  CHECK(!directCommandFresh(t0, t0 + 200000000LL, limit));  // stale: 200 ms old
  CHECK(!directCommandFresh(t0, t0 - 1, limit));            // clock went backwards
  CHECK(!directCommandFresh(0, t0, limit));                 // never received
  CHECK(!directCommandFresh(t0, t0, 0));                    // invalid timeout

  // --- Bench motion -------------------------------------------------------
  // RPM conversion: 1 rad/s x 60/(2 pi) x 50 = 477.46 motor RPM.
  auto c = benchMotorCommand(1.0, 50.0, false, 500.0);
  CHECK(c.direction == 1 && c.raw_rpm == 477 && !c.clamped);
  c = benchMotorCommand(-0.5, 50.0, false, 500.0);   // 238.73
  CHECK(c.direction == 2 && c.raw_rpm == 239);
  // Cap.
  c = benchMotorCommand(1.0, 50.0, false, 300.0);
  CHECK(c.direction == 1 && c.raw_rpm == 300 && c.clamped);
  c = benchMotorCommand(-100.0, 50.0, false, 300.0);
  CHECK(c.direction == 2 && c.raw_rpm == 300 && c.clamped);
  // Mirroring flips direction only.
  c = benchMotorCommand(1.0, 50.0, true, 500.0);
  CHECK(c.direction == 2 && c.raw_rpm == 477);
  c = benchMotorCommand(-1.0, 50.0, true, 500.0);
  CHECK(c.direction == 1 && c.raw_rpm == 477);
  // Deadband: below 1 motor RPM is a stop; 0.0021 rad/s = 1.003 RPM is not.
  c = benchMotorCommand(0.002, 50.0, false, 500.0);  // 0.955 RPM
  CHECK(c.direction == 0 && c.raw_rpm == 0);
  c = benchMotorCommand(0.0021, 50.0, false, 500.0);
  CHECK(c.direction == 1 && c.raw_rpm == 1);
  CHECK(benchMotorCommand(0.0, 50.0, false, 500.0).direction == 0);
  // Anything invalid is a stop, never an error that keeps the old command.
  CHECK(benchMotorCommand(std::numeric_limits<double>::quiet_NaN(), 50, false, 500).direction == 0);
  CHECK(benchMotorCommand(std::numeric_limits<double>::infinity(), 50, false, 500).direction == 0);
  CHECK(benchMotorCommand(1.0, 0.0, false, 500).direction == 0);
  CHECK(benchMotorCommand(1.0, 50.0, false, 0.0).direction == 0);

  // Read-back: raw RPM to wheel rad/s, sign from direction then mirroring.
  CHECK(std::abs(benchWheelSpeedFromRaw(477, 50.0, false, 1) - 0.99903) < 1e-4);
  CHECK(std::abs(benchWheelSpeedFromRaw(477, 50.0, false, 2) + 0.99903) < 1e-4);
  CHECK(std::abs(benchWheelSpeedFromRaw(477, 50.0, true, 2) - 0.99903) < 1e-4);
  CHECK(std::isnan(benchWheelSpeedFromRaw(477, 0.0, false, 1)));

  // Write planner: one write per cycle, stop first, speed before direction.
  const std::int64_t ms = 1000000;
  const std::int64_t resend = 500 * ms;  // 2 Hz: 1 s - one period
  const BenchMotorCommand fwd{1, 300, false}, rev{2, 300, false}, stop{};
  BenchOutputState s;
  std::int64_t now = 1000 * ms;
  auto step = [&](const BenchMotorCommand & target) {
      const auto w = planBenchWrite(s, target, now, resend);
      if (w.reg != BenchRegister::NONE) recordBenchWrite(s, w, true, now);
      return w;
    };
  auto w = step(fwd);  // unknown direction: stop first
  CHECK(w.reg == BenchRegister::CONTROL && w.value == 0);
  w = step(fwd);
  CHECK(w.reg == BenchRegister::SPEED && w.value == 300);
  w = step(fwd);
  CHECK(w.reg == BenchRegister::CONTROL && w.value == 1);
  CHECK(step(fwd).reg == BenchRegister::NONE);  // write only what changed
  // Speed change in the same direction is a single speed write.
  w = step({1, 200, false});
  CHECK(w.reg == BenchRegister::SPEED && w.value == 200);
  // Re-send: both due, the older (direction) goes first, then speed.
  now += resend;
  w = step({1, 200, false});
  CHECK(w.reg == BenchRegister::CONTROL && w.value == 1);
  w = step({1, 200, false});
  CHECK(w.reg == BenchRegister::SPEED && w.value == 200);
  CHECK(step({1, 200, false}).reg == BenchRegister::NONE);
  // Reversal: stop, speed, direction.
  w = step(rev);
  CHECK(w.reg == BenchRegister::CONTROL && w.value == 0);
  w = step(rev);
  CHECK(w.reg == BenchRegister::SPEED && w.value == 300);
  w = step(rev);
  CHECK(w.reg == BenchRegister::CONTROL && w.value == 2);
  // Stop always wins, even with a speed change pending.
  w = step(stop);
  CHECK(w.reg == BenchRegister::CONTROL && w.value == 0);
  CHECK(step(stop).reg == BenchRegister::NONE);
  now += resend;
  w = step(stop);  // a stopped drive still gets its stop re-sent
  CHECK(w.reg == BenchRegister::CONTROL && w.value == 0);
  // A failed write makes the register unknown, so the next plan stops first.
  recordBenchWrite(s, {BenchRegister::CONTROL, 1}, false, now);
  w = planBenchWrite(s, fwd, now, resend);
  CHECK(w.reg == BenchRegister::CONTROL && w.value == 0);

  // Wire-time floors at 9600 8N1: 1.0417 ms per character, 3.646 ms silence.
  const RtuFraming f9600{9600, 8, false, 1};
  CHECK(std::abs(rtuCharMs(f9600) - 1.041667) < 1e-4);
  CHECK(std::abs(rtuSilenceMs(f9600) - 3.645833) < 1e-4);
  // 4 x [(15 + 16) chars + 4 silences] = 187.5 ms
  CHECK(std::abs(benchWorstCycleFloorMs(f9600, 4) - 187.5) < 1e-3);
  // 8 chars + 1 silence + 50 ms timeout + 4 x (15 chars + 2 silences) = 153.65 ms
  CHECK(std::abs(benchStopFloorMs(f9600, 4, 50.0) - 153.646) < 1e-2);
  CHECK(rtuSilenceMs(RtuFraming{38400, 8, false, 1}) == 1.75);

  std::cout << "core tests passed\n";
}
