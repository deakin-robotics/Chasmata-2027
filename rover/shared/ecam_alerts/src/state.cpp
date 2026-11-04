#include "ecam_alerts/state.hpp"

#include <algorithm>
#include <cctype>
#include <set>
#include <utility>

#include "ecam_alerts/source.hpp"

namespace ecam_alerts
{
namespace
{
std::vector<std::string> normalize_codes(const std::vector<std::string> & codes)
{
  std::set<std::string> normalized;
  for (const auto & code : codes) {
    const auto first = std::find_if_not(code.begin(), code.end(), [](unsigned char character) {
      return std::isspace(character) != 0;
    });
    const auto last = std::find_if_not(code.rbegin(), code.rend(), [](unsigned char character) {
      return std::isspace(character) != 0;
    }).base();
    if (first < last) {
      normalized.emplace(first, last);
    }
  }
  return {normalized.begin(), normalized.end()};
}
}  // namespace

bool SourceSnapshot::operator==(const SourceSnapshot & other) const
{
  return source == other.source && timestamp.sec == other.timestamp.sec &&
         timestamp.nanosec == other.timestamp.nanosec && active_codes == other.active_codes;
}

bool timestamp_less(const builtin_interfaces::msg::Time & left,
  const builtin_interfaces::msg::Time & right)
{
  return left.sec < right.sec || (left.sec == right.sec && left.nanosec < right.nanosec);
}

bool SourceSnapshotStore::update(const std::string & source,
  const builtin_interfaces::msg::Time & timestamp, const std::vector<std::string> & active_codes)
{
  if (!is_valid_source(source)) {
    return false;
  }
  const auto existing = std::find_if(snapshots_.begin(), snapshots_.end(), [&source](const SourceSnapshot & snapshot) {
    return snapshot.source == source;
  });
  if (existing != snapshots_.end() && timestamp_less(timestamp, existing->timestamp)) {
    return false;
  }
  SourceSnapshot snapshot{source, timestamp, normalize_codes(active_codes)};
  if (existing != snapshots_.end() && *existing == snapshot) {
    return false;
  }
  if (existing == snapshots_.end()) {
    snapshots_.push_back(std::move(snapshot));
  } else {
    *existing = std::move(snapshot);
  }
  return true;
}

const SourceSnapshot * SourceSnapshotStore::get(const std::string & source) const
{
  const auto existing = std::find_if(snapshots_.begin(), snapshots_.end(), [&source](const SourceSnapshot & snapshot) {
    return snapshot.source == source;
  });
  return existing == snapshots_.end() ? nullptr : &*existing;
}

std::vector<SourceSnapshot> SourceSnapshotStore::snapshots() const
{
  std::vector<SourceSnapshot> ordered;
  for (const char * source : {"driver", "ecam", "arm", "basestation", "rover"}) {
    if (const auto * snapshot = get(source)) {
      ordered.push_back(*snapshot);
    }
  }
  return ordered;
}

std::vector<std::string> SourceSnapshotStore::active_codes() const
{
  std::set<std::string> codes;
  for (const auto & snapshot : snapshots_) {
    codes.insert(snapshot.active_codes.begin(), snapshot.active_codes.end());
  }
  return {codes.begin(), codes.end()};
}

bool SourceSnapshotStore::reflects(const SourceSnapshotStore & expected, const std::string & exclude) const
{
  for (const char * source : {"driver", "ecam", "arm", "basestation", "rover"}) {
    if (exclude == source) {
      continue;
    }
    const auto * expected_snapshot = expected.get(source);
    if (expected_snapshot != nullptr) {
      const auto * actual_snapshot = get(source);
      if (actual_snapshot == nullptr || !(*actual_snapshot == *expected_snapshot)) {
        return false;
      }
    }
  }
  return true;
}
}  // namespace ecam_alerts
