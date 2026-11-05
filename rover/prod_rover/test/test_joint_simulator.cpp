#include <gtest/gtest.h>

#include "prod_rover/joint_simulator.hpp"

namespace
{
prod_rover::JointSimulator make_simulator()
{
  return prod_rover::JointSimulator({"base_joint", "shoulder_joint"},
    {{"base_joint", {-1.0, 1.0}}, {"shoulder_joint", {-0.5, 0.5}}}, 1.0);
}
}

TEST(JointSimulator, ClampsTargetsAndMovesAtConfiguredSpeed)
{
  auto simulator = make_simulator();
  EXPECT_EQ(simulator.set_target({{"base_joint", 5.0}, {"shoulder_joint", -2.0}}),
    (prod_rover::JointSimulator::JointValues{{"base_joint", 1.0}, {"shoulder_joint", -0.5}}));
  simulator.step(0.25);
  EXPECT_DOUBLE_EQ(simulator.positions().at("base_joint"), 0.25);
  EXPECT_DOUBLE_EQ(simulator.velocities().at("base_joint"), 1.0);
}

TEST(JointSimulator, SupportsImmediateAndMeasuredPositions)
{
  auto simulator = make_simulator();
  simulator.set_target_immediately({{"base_joint", 0.2}});
  EXPECT_DOUBLE_EQ(simulator.positions().at("base_joint"), 0.2);
  EXPECT_DOUBLE_EQ(simulator.velocities().at("base_joint"), 0.0);
  simulator.set_actual_positions({{"base_joint", 0.4}, {"shoulder_joint", 2.0}},
    {{"base_joint", 0.7}, {"shoulder_joint", -0.2}});
  EXPECT_DOUBLE_EQ(simulator.positions().at("shoulder_joint"), 0.5);
  EXPECT_DOUBLE_EQ(simulator.velocities().at("base_joint"), 0.7);
}

TEST(JointSimulator, StopsAtTargetWithoutOvershoot)
{
  auto simulator = make_simulator();
  simulator.set_target({{"base_joint", 0.3}});
  simulator.step(1.0);
  EXPECT_DOUBLE_EQ(simulator.positions().at("base_joint"), 0.3);
  EXPECT_DOUBLE_EQ(simulator.velocities().at("base_joint"), 0.0);
}
