#pragma once

#include <string>
#include <vector>

#include <builtin_interfaces/msg/time.hpp>

namespace ecam_alerts
{
struct SourceSnapshot
{
  std::string source;
  builtin_interfaces::msg::Time timestamp;
  std::vector<std::string> active_codes;
  bool operator==(const SourceSnapshot & other) const;
};

class SourceSnapshotStore
{
public:
  bool update(const std::string & source, const builtin_interfaces::msg::Time & timestamp,
    const std::vector<std::string> & active_codes);
  const SourceSnapshot * get(const std::string & source) const;
  std::vector<SourceSnapshot> snapshots() const;
  std::vector<std::string> active_codes() const;
  bool reflects(const SourceSnapshotStore & expected, const std::string & exclude = "rover") const;

private:
  std::vector<SourceSnapshot> snapshots_;
};

bool timestamp_less(const builtin_interfaces::msg::Time & left,
  const builtin_interfaces::msg::Time & right);
}  // namespace ecam_alerts
