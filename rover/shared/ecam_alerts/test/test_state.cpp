#include <gtest/gtest.h>

#include <memory>
#include <rclcpp/rclcpp.hpp>
#include <stdexcept>

#include "ecam_alerts/source.hpp"
#include "ecam_alerts/state.hpp"

namespace
{
builtin_interfaces::msg::Time time_at(int32_t seconds, uint32_t nanoseconds)
{
  builtin_interfaces::msg::Time time;
  time.sec = seconds;
  time.nanosec = nanoseconds;
  return time;
}
}  // namespace

TEST(SourceSnapshotStore, CompletesDeduplicatesAndOrdersSnapshots)
{
  ecam_alerts::SourceSnapshotStore store;
  EXPECT_TRUE(store.update("arm", time_at(10, 5), {"ARM_FAULT", "ARM_FAULT"}));
  EXPECT_TRUE(store.update("driver", time_at(10, 2), {"DRIVE_FAULT"}));
  const auto snapshots = store.snapshots();
  ASSERT_EQ(snapshots.size(), 2U);
  EXPECT_EQ(snapshots[0].source, "driver");
  EXPECT_EQ(snapshots[1].source, "arm");
  EXPECT_EQ(store.get("arm")->active_codes, std::vector<std::string>({"ARM_FAULT"}));
  EXPECT_TRUE(store.update("arm", time_at(11, 0), {}));
  EXPECT_TRUE(store.get("arm")->active_codes.empty());
}

TEST(SourceSnapshotStore, RejectsUnknownAndOlderSnapshots)
{
  ecam_alerts::SourceSnapshotStore store;
  EXPECT_TRUE(store.update("ecam", time_at(1, 0), {"A"}));
  EXPECT_FALSE(store.update("ecam", time_at(1, 0), {"A", "A"}));
  EXPECT_FALSE(store.update("operator", time_at(2, 0), {"B"}));
  EXPECT_EQ(store.get("operator"), nullptr);
  EXPECT_TRUE(store.update("driver", time_at(10, 0), {"CURRENT"}));
  EXPECT_FALSE(store.update("driver", time_at(9, 999999999), {"STALE"}));
  EXPECT_EQ(store.get("driver")->active_codes, std::vector<std::string>({"CURRENT"}));
}

TEST(SourceSnapshotStore, MergesAndReflectsNonRoverSnapshots)
{
  ecam_alerts::SourceSnapshotStore store;
  store.update("driver", time_at(1, 0), {"SHARED", "DRIVE"});
  store.update("arm", time_at(1, 0), {"SHARED", "ARM"});
  EXPECT_EQ(store.active_codes(), std::vector<std::string>({"ARM", "DRIVE", "SHARED"}));

  ecam_alerts::SourceSnapshotStore expected;
  expected.update("basestation", time_at(9, 4), {"BASE_FAULT"});
  expected.update("rover", time_at(9, 3), {"ROVER_FAULT"});
  ecam_alerts::SourceSnapshotStore returned;
  returned.update("basestation", time_at(9, 4), {"BASE_FAULT"});
  returned.update("rover", time_at(100, 0), {});
  EXPECT_TRUE(returned.reflects(expected));
  returned.update("basestation", time_at(9, 5), {});
  EXPECT_FALSE(returned.reflects(expected));
}

TEST(EcamAlertSource, ValidatesAndNormalizesCodes)
{
  int argc = 0;
  rclcpp::init(argc, nullptr);
  auto node = std::make_shared<rclcpp::Node>("test_ecam_alert_source");
  EXPECT_THROW(ecam_alerts::EcamAlertSource(*node, "operator"), std::invalid_argument);
  ecam_alerts::EcamAlertSource source(*node, "rover");
  source.raise_alert("  Z_ALERT ");
  source.raise_alert("A_ALERT");
  source.raise_alert("Z_ALERT");
  EXPECT_EQ(source.active_codes(), std::vector<std::string>({"A_ALERT", "Z_ALERT"}));
  source.clear(" Z_ALERT ");
  EXPECT_EQ(source.active_codes(), std::vector<std::string>({"A_ALERT"}));
  source.clear_all();
  EXPECT_TRUE(source.active_codes().empty());
  node.reset();
  rclcpp::shutdown();
}
