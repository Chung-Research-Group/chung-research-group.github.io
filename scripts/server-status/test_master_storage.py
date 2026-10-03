"""Offline storage parser and collector isolation checks; never connect to SSH."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest import mock

import inspect_master_storage as storage

HERE = Path(__file__).resolve().parent
accounting = types.ModuleType('inspect_slurm_accounting')
accounting.summarize_observation = lambda observation: observation
with mock.patch.dict(sys.modules, {'inspect_slurm_accounting': accounting}):
    spec = importlib.util.spec_from_file_location('disk_collector_test', HERE / 'collect_resources.py')
    collector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(collector)


def mount(target, identity='8:1', fstype='ext4', source='/dev/sda1', mode='rw', root='/'):
    return '40 1 %s %s %s %s,relatime - %s %s %s,private_option=PRIVATE_OPTION' % (
        identity, root, target, mode, fstype, source, mode)


HEADER = 'Filesystem Type 1B-blocks Used Available Use% Mounted on\n'


def df(target, source='/dev/sda1', fstype='ext4', total=100, used=60, available=30, percent=67):
    return '%s %s %s %s %s %s%% %s\n' % (source, fstype, total, used, available, percent, target)


class StorageParserTests(unittest.TestCase):
    def test_reserved_blocks_use_df_percentage_not_used_over_total(self):
        result = storage.normalize(mount('/'), HEADER + df('/'))
        row = result['volumes'][0]
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(row['use_percent'], 67)
        self.assertEqual(row['available_bytes'], 30)
        self.assertEqual(row['device'], '/dev/sda1')
        self.assertEqual(row['scope'], 'master_local')
        self.assertEqual(result['disks'], [])
        self.assertNotIn('physical_disk_bytes', result)

    def test_shared_aliases_are_one_filesystem_and_sources_never_escape(self):
        targets = ['/scratch', '/home', '/archive']
        info = '\n'.join(mount(target, '0:52', 'nfs4', 'SECRET_USER@private.example:/PRIVATE_EXPORT') for target in targets)
        report = HEADER + ''.join(df(target, 'SECRET_USER@private.example:/PRIVATE_EXPORT', 'nfs4') for target in targets)
        result = storage.normalize(info, report)
        self.assertEqual(len(result['volumes']), 1)
        self.assertEqual(result['volumes'][0]['mounts'], targets)
        self.assertEqual(result['volumes'][0]['device'], 'Network volume')
        self.assertEqual(result['volumes'][0]['scope'], 'shared')
        self.assertEqual(result['volumes'][0]['total_bytes'], 100)
        encoded = json.dumps(result)
        for private in ('SECRET_USER', 'private.example', 'PRIVATE_EXPORT', 'PRIVATE_OPTION', '0:52'):
            self.assertNotIn(private, encoded)

    def test_same_source_with_distinct_kernel_instances_is_not_merged(self):
        info = mount('/scratch', '0:52', 'nfs4', 'server:/export') + '\n' + mount('/data0', '0:53', 'nfs4', 'server:/export')
        report = HEADER + df('/scratch', 'server:/export', 'nfs4') + df('/data0', 'server:/export', 'nfs4')
        self.assertEqual(len(storage.normalize(info, report)['volumes']), 2)

    def test_bind_mounts_and_subvolumes_merge_without_summing(self):
        info = mount('/', root='/') + '\n' + mount('/alias', root='/subvolume')
        result = storage.normalize(info, HEADER + df('/'))
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['volumes'][0]['mounts'], ['/', '/alias'])
        self.assertEqual(result['volumes'][0]['total_bytes'], 100)

    def test_disagreeing_subvolume_totals_remain_unknown(self):
        info = mount('/') + '\n' + mount('/alias', root='/subvolume')
        result = storage.normalize(info, HEADER + df('/') + df('/alias', total=200))
        self.assertEqual(result['status'], 'partial')
        self.assertIsNone(result['volumes'][0]['available_bytes'])

    def test_changing_alias_counters_keep_one_complete_conservative_sample(self):
        info = mount('/') + '\n' + mount('/alias')
        result = storage.normalize(info, HEADER + df('/') + df('/alias', used=65, available=25, percent=73))
        row = result['volumes'][0]
        self.assertEqual((row['used_bytes'], row['available_bytes'], row['use_percent']), (65, 25, 73))

    def test_pseudo_loop_and_temporary_mounts_are_excluded(self):
        info = '\n'.join([mount('/'), mount('/tmp', '8:2'), mount('/run/media/user/disk', '8:3'),
                          mount('/snap/tool', '7:0', 'ext4', '/dev/loop0'), mount('/memory', '0:1', 'tmpfs', 'tmpfs')])
        result = storage.normalize(info, HEADER + df('/'))
        self.assertEqual(len(result['volumes']), 1)
        self.assertEqual(result['volumes'][0]['mounts'], ['/'])

    def test_private_mounts_uuid_and_escaped_space(self):
        target = '/home/PRIVATE_USER/work'
        info = mount(target) + '\n' + mount('/mnt/12345678-1234-1234-1234-123456789abc', '8:2') + '\n' + mount('/data\\040space', '8:3')
        result = storage.normalize(info, HEADER + df(target) + df('/mnt/12345678-1234-1234-1234-123456789abc') + df('/data space'))
        labels = [row['mounts'][0] for row in result['volumes']]
        self.assertEqual(labels, ['/home/…', '/mnt/…', '/data space'])
        self.assertNotIn('PRIVATE_USER', json.dumps(result))

    def test_mapper_device_uses_kernel_name_without_private_mapper_label(self):
        with mock.patch.object(storage.os.path, 'realpath', return_value='/dev/dm-0'):
            result = storage.normalize(mount('/', source='/dev/mapper/PRIVATE_HOST-root'), HEADER + df('/', source='/dev/mapper/PRIVATE_HOST-root'))
        self.assertEqual(result['volumes'][0]['device'], '/dev/dm-0')
        self.assertNotIn('PRIVATE_HOST', json.dumps(result))
        with mock.patch.object(storage.os.path, 'realpath', return_value='/dev/mapper/PRIVATE_HOST-root'):
            self.assertEqual(storage.local_device('/dev/mapper/PRIVATE_HOST-root'), 'Local filesystem')

    def test_readonly_and_mixed_access(self):
        result = storage.normalize(mount('/', mode='ro'), HEADER + df('/'))
        self.assertEqual(result['volumes'][0]['mount_access'], 'read_only')
        result = storage.normalize(mount('/', mode='ro') + '\n' + mount('/alias'), HEADER + df('/'))
        self.assertEqual(result['volumes'][0]['mount_access'], 'mixed')

    def test_missing_or_ambiguous_mountinfo_fails_closed(self):
        for info in ('', 'broken', mount('/') + '\n' + mount('/', '8:2')):
            result = storage.normalize(info, HEADER + df('/'))
            self.assertEqual(result['status'], 'unavailable')
            self.assertEqual(result['volumes'], [])

    def test_df_failure_preserves_known_mounts_with_unknown_capacity(self):
        result = storage.normalize(mount('/'), '', False)
        self.assertEqual(result['status'], 'partial')
        row = result['volumes'][0]
        self.assertEqual(row['mounts'], ['/'])
        self.assertEqual(row['status'], 'usage_unknown')
        for key in ('total_bytes', 'used_bytes', 'available_bytes', 'use_percent'):
            self.assertIsNone(row[key])
        self.assertEqual(row['space_status'], 'unknown')

    def test_partial_df_exit_retains_valid_local_samples_and_unknown_missing_mounts(self):
        info = mount('/') + '\n' + mount('/scratch', '0:52', 'nfs4', 'private.example:/export')
        result = storage.normalize(info, HEADER + df('/'), False)
        self.assertEqual(result['status'], 'partial')
        local, shared = result['volumes']
        self.assertEqual(local['status'], 'mounted')
        self.assertEqual(local['available_bytes'], 30)
        self.assertEqual(local['use_percent'], 67)
        self.assertEqual(shared['status'], 'usage_unknown')
        self.assertIsNone(shared['available_bytes'])

    def test_malformed_row_does_not_discard_other_valid_filesystems(self):
        info = mount('/') + '\n' + mount('/data', '8:2')
        result = storage.normalize(info, HEADER + df('/') + df('/data', percent=25) + 'malformed\n')
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['volumes'][0]['status'], 'mounted')
        self.assertEqual(result['volumes'][1]['status'], 'usage_unknown')

    def test_invalid_counter_percentage_or_df_header_never_looks_current(self):
        for report in (HEADER + df('/', percent=60), HEADER + df('/', available=-1),
                       HEADER + df('/', total=0, used=0, available=0, percent=0),
                       'not df\n' + df('/'), HEADER + 'malformed\n', HEADER):
            result = storage.normalize(mount('/'), report)
            self.assertEqual(result['status'], 'partial')
            self.assertIsNone(result['volumes'][0]['available_bytes'])

    def test_full_low_and_small_filesystem_warnings(self):
        for report, expected in ((df('/', used=100, available=0, percent=100), 'full'),
                                 (df('/', used=85, available=5, percent=95), 'low'),
                                 (df('/', total=500_000_000, used=40_000_000, available=460_000_000, percent=8), 'ok'),
                                 (df('/', total=100_000_000_000, used=70_000_000_000, available=15_000_000_000, percent=83), 'low')):
            result = storage.normalize(mount('/'), HEADER + report)
            self.assertEqual(result['volumes'][0]['space_status'], expected)
            self.assertEqual(result['low_space_filesystems'], int(expected != 'ok'))

    def test_df_command_is_bounded_and_failures_do_not_leak_errors(self):
        with mock.patch.object(storage.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['df'], 8)) as run:
            self.assertEqual(storage.run_df(), (False, ''))
        self.assertEqual(run.call_args.args[0], ['df', '-P', '-T', '-B1'])
        self.assertEqual(run.call_args.kwargs['timeout'], 8)
        self.assertEqual(run.call_args.kwargs['env']['LC_ALL'], 'C')


CLUSTER = {'host': 'sg', 'ssh_target': 'existing-sg-alias', 'ssh_port': 7777}


class CollectorIsolationTests(unittest.TestCase):
    def record(self, status='ok'):
        return {'host': 'sg', 'kind': 'slurm_cluster', 'status': status,
                'local_started_at_utc': '2026-10-03T00:00:00+00:00',
                'local_completed_at_utc': '2026-10-03T00:00:01+00:00',
                'usage': {'retained': 11}, 'job_counter': {'latest_job_id': 42},
                'slurm_cpus_total': 100, 'collector_sha256': {'resources': 'existing'}}

    def test_optional_query_has_separate_timeout_and_fixed_existing_endpoint(self):
        value = storage.normalize(mount('/'), HEADER + df('/'))
        with mock.patch.object(collector, 'collect', return_value={'status': 'ok', 'storage': value}) as collect:
            result = collector.collect_master_storage(CLUSTER, 'print("{}")')
        self.assertEqual(result, value)
        self.assertEqual(collect.call_args.args, ('sg', 'python3 -', 'existing-sg-alias', 7777))
        self.assertEqual(collect.call_args.kwargs['timeout'], 30)
        self.assertIn('"storage":json.loads', collect.call_args.kwargs['input_source'])

    def test_original_query_timeout_and_ssh_authentication_options_are_unchanged(self):
        response = types.SimpleNamespace(returncode=0, stdout='{}', stderr='')
        with mock.patch.object(collector.subprocess, 'run', return_value=response) as run:
            collector.collect('oxygen', 'existing-command')
        self.assertEqual(run.call_args.kwargs['timeout'], 100)
        command = run.call_args.args[0]
        for option in ('BatchMode=yes', 'StrictHostKeyChecking=yes', 'ForwardAgent=no', 'ForwardX11=no', 'ClearAllForwardings=yes'):
            self.assertIn(option, command)

    def test_storage_timeout_and_invalid_result_are_explicit_unknown(self):
        for result in ({'status': 'unreachable'}, {'status': 'ok', 'storage': []},
                       {'status': 'ok', 'storage': {'status': 'ok', 'scope': 'wrong', 'volumes': []}}):
            with mock.patch.object(collector, 'collect', return_value=result):
                self.assertEqual(collector.collect_master_storage(CLUSTER, '')['status'], 'unavailable')
        with mock.patch.object(collector, 'collect', side_effect=RuntimeError('PRIVATE_ERROR')):
            result = collector.collect_master_storage(CLUSTER, '')
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('PRIVATE_ERROR', json.dumps(result))

    def test_optional_failure_preserves_scheduler_and_milestone_input_fields(self):
        record = self.record()
        before = copy.deepcopy(record)
        with mock.patch.object(Path, 'read_text', return_value='helper source'), mock.patch.object(collector, 'collect', side_effect=RuntimeError('failure')):
            collector.attach_master_storage(record, CLUSTER)
        for key in ('status', 'usage', 'job_counter', 'slurm_cpus_total', 'local_completed_at_utc'):
            self.assertEqual(record[key], before[key])
        self.assertEqual(record['storage']['status'], 'unavailable')
        self.assertEqual(record['collector_sha256']['resources'], 'existing')
        self.assertEqual(len(record['collector_sha256']['storage']), 64)

    def test_successful_storage_survives_failed_scheduler_summary(self):
        record = self.record('unreachable')
        record['storage'] = storage.normalize(mount('/'), HEADER + df('/'))
        result = collector.summarize(record)
        self.assertEqual(result['status'], 'unreachable')
        self.assertEqual(result['storage']['status'], 'ok')
        self.assertNotIn('slurm_cpus_total', result)
        self.assertNotIn('job_counter', result)

    def test_other_hosts_and_clusters_never_call_new_helper(self):
        for host in ('oxygen', 'carbon', 'different-cluster'):
            record = self.record()
            before = copy.deepcopy(record)
            with mock.patch.object(collector, 'collect_master_storage') as query:
                collector.attach_master_storage(record, {**CLUSTER, 'host': host})
            query.assert_not_called()
            self.assertEqual(record, before)

    def test_missing_optional_helper_is_nonfatal(self):
        record = self.record()
        with mock.patch.object(Path, 'read_text', side_effect=OSError('missing')):
            collector.attach_master_storage(record, CLUSTER)
        self.assertEqual(record['status'], 'ok')
        self.assertEqual(record['storage']['status'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
