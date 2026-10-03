"""Public SG storage projection/rendering checks, without SSH or publishing."""
import copy
import datetime as dt
import json
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import detailed_status as dashboard

LIVE = Path('C:/Users/User/compute/monitoring/resources')


def storage_fixture():
    return {'status': 'ok', 'scope': 'sg_master_mounts',
            'checked_at_utc': '2026-10-03T14:00:00+00:00', 'disks': [],
            'low_space_filesystems': 1, 'private_config': 'SECRET_CONFIGURATION',
            'volumes': [
                {'device': 'Network volume', 'mounts': ['/archive', '/home', '/scratch'],
                 'scope': 'shared', 'fstype': 'nfs4', 'status': 'mounted', 'mount_access': 'read_write',
                 'total_bytes': 200_000_000_000_000, 'used_bytes': 53_000_000_000_000,
                 'available_bytes': 147_000_000_000_000, 'use_percent': 27,
                 'space_status': 'ok', 'source': '192.0.2.7:/PRIVATE_EXPORT', 'options': 'SECRET_OPTIONS'},
                {'device': '/dev/dm-0', 'mounts': ['/'], 'scope': 'master_local', 'fstype': 'xfs',
                 'status': 'mounted', 'total_bytes': 400_000_000_000, 'used_bytes': 390_000_000_000,
                 'available_bytes': 10_000_000_000, 'use_percent': 98, 'space_status': 'low'}]}


class StorageProjection(unittest.TestCase):
    def test_sg_storage_keeps_measurements_and_observation_time(self):
        source = storage_fixture()
        row = dashboard.project_row({'kind': 'slurm_cluster', 'host': 'sg', 'status': 'ok', 'storage': source}, include_identities=True)
        self.assertEqual(row['storage']['checked_at_utc'], source['checked_at_utc'])
        for wanted, actual in zip(source['volumes'], row['storage']['volumes']):
            for field in ['total_bytes', 'used_bytes', 'available_bytes', 'use_percent', 'mounts', 'scope']:
                self.assertEqual(actual[field], wanted[field])
        self.assertEqual(len(row['storage']['volumes']), 2)
        self.assertNotIn('physical_disk_bytes', row['storage'])

    def test_private_metadata_never_reaches_public_payload(self):
        row = dashboard.project_row({'kind': 'slurm_cluster', 'host': 'sg', 'storage': storage_fixture()}, include_identities=True)
        text = json.dumps(row)
        for secret in ['SECRET_', 'PRIVATE_', '192.0.2.7', 'options', 'source']:
            self.assertNotIn(secret, text)

    def test_storage_is_independent_of_failed_slurm_query(self):
        row = dashboard.project_row({'kind': 'slurm_cluster', 'host': 'sg', 'status': 'invalid', 'storage': storage_fixture()}, include_identities=True)
        self.assertEqual(row['status'], 'invalid')
        self.assertEqual(row['storage']['status'], 'ok')
        self.assertEqual(row['storage']['volumes'][0]['use_percent'], 27)

    def test_absent_or_incomplete_storage_does_not_invent_capacity(self):
        row = dashboard.project_row({'kind': 'slurm_cluster', 'host': 'sg', 'status': 'ok'}, include_identities=True)
        self.assertEqual(row['storage']['status'], 'unavailable')
        partial = storage_fixture()
        partial.update(status='partial')
        partial['volumes'][0].update(status='usage_unknown', total_bytes=None, used_bytes=None, available_bytes=None, use_percent=None)
        projected = dashboard._storage(partial, True)
        self.assertIsNone(projected['volumes'][0]['available_bytes'])
        self.assertIsNone(projected['volumes'][0]['use_percent'])

    def test_nested_types_cannot_bypass_the_projection(self):
        for key in ['use_percent', 'scope', 'checked_at_utc']:
            source = storage_fixture()
            target = source if key == 'checked_at_utc' else source['volumes'][0]
            target[key] = {'SECRET': 'metadata'}
            with self.assertRaises(ValueError):
                dashboard._storage(source, True)

    @unittest.skipUnless((LIVE / 'dashboard_template.html').exists(), 'Existing lab template unavailable')
    def test_real_renderer_contains_both_locales_and_stays_below_limit(self):
        artifact = dashboard.build(LIVE, include_identities=True)
        payload = json.loads(re.search(rb'<script id="resource-data" type="application/json">(.*?)</script>', artifact['html'], re.S).group(1))
        payload['servers'][0]['latest']['storage'] = dashboard._storage(storage_fixture(), True)
        html = dashboard.render(LIVE, payload)
        self.assertLess(len(html), 200 * 1024)
        for text in ['SG-Master storage', 'SG-Master 저장 공간', 'Shared storage', '공유 저장소', 'use_percent']:
            self.assertIn(text.encode('utf-8'), html)
        self.assertNotIn(b'SECRET_', html)


if __name__ == '__main__':
    unittest.main()
