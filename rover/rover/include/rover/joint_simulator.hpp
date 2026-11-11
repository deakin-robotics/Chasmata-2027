#pragma once

#include <map>
#include <string>
#include <utility>
#include <vector>

namespace rover
{
class JointSimulator
{
public:
  using JointValues = std::map<std::string, double>;
  using JointLimits = std::map<std::string, std::pair<double, double>>;

  JointSimulator(std::vector<std::string> joint_names, JointLimits joint_limits, double max_speed_rad_s);
  JointValues set_target(const JointValues & values);
  JointValues set_target_immediately(const JointValues & values);
  JointValues set_actual_positions(const JointValues & values, const JointValues & velocities = {});
  void step(double elapsed_seconds);
  JointValues positions() const;
  JointValues velocities() const;

private:
  std::vector<std::string> joint_names_;
  JointLimits joint_limits_;
  double max_speed_rad_s_;
  JointValues positions_;
  JointValues targets_;
  JointValues velocities_;
};
}  // namespace rover
