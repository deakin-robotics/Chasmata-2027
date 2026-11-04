import unittest

from ecam_alerts.state import SourceSnapshotStore


class SourceSnapshotStoreTest(unittest.TestCase):
    def test_source_snapshots_are_complete_deduplicated_and_ordered(self):
        store = SourceSnapshotStore()

        self.assertTrue(store.update('arm', (10, 5), ['ARM_FAULT', 'ARM_FAULT']))
        self.assertTrue(store.update('driver', (10, 2), ['DRIVE_FAULT']))
        self.assertEqual([snapshot.source for snapshot in store.snapshots()], ['driver', 'arm'])
        self.assertEqual(store.get('arm').active_codes, ('ARM_FAULT',))
        self.assertTrue(store.update('arm', (11, 0), []))
        self.assertEqual(store.get('arm').active_codes, ())

    def test_duplicate_snapshot_does_not_change_state_and_unknown_source_is_ignored(self):
        store = SourceSnapshotStore()

        self.assertTrue(store.update('ecam', (1, 0), ['A']))
        self.assertFalse(store.update('ecam', (1, 0), ['A', 'A']))
        self.assertFalse(store.update('operator', (2, 0), ['B']))
        self.assertIsNone(store.get('operator'))

    def test_older_snapshot_does_not_replace_a_newer_source_state(self):
        store = SourceSnapshotStore()
        store.update('driver', (10, 0), ['CURRENT'])

        self.assertFalse(store.update('driver', (9, 999_999_999), ['STALE']))
        self.assertEqual(store.get('driver').timestamp, (10, 0))
        self.assertEqual(store.get('driver').active_codes, ('CURRENT',))

    def test_active_codes_merge_across_sources_until_each_source_clears(self):
        store = SourceSnapshotStore()
        store.update('driver', (1, 0), ['SHARED', 'DRIVE'])
        store.update('arm', (1, 0), ['SHARED', 'ARM'])

        self.assertEqual(store.active_codes(), ('ARM', 'DRIVE', 'SHARED'))
        store.update('driver', (2, 0), [])
        self.assertEqual(store.active_codes(), ('ARM', 'SHARED'))
        store.update('arm', (2, 0), [])
        self.assertEqual(store.active_codes(), ())

    def test_reflection_requires_latest_non_rover_source_snapshot(self):
        expected = SourceSnapshotStore()
        expected.update('basestation', (9, 4), ['BASE_FAULT'])
        expected.update('rover', (9, 3), ['ROVER_FAULT'])

        returned = SourceSnapshotStore()
        returned.update('basestation', (9, 4), ['BASE_FAULT'])
        returned.update('rover', (100, 0), [])
        self.assertTrue(returned.reflects(expected))

        returned.update('basestation', (9, 5), [])
        self.assertFalse(returned.reflects(expected))


if __name__ == '__main__':
    unittest.main()
