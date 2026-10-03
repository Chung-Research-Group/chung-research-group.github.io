"""Read mounted filesystem capacity visible from SG-Master, without file scans.

Mount identities and remote sources stay private. The public result contains one
row per kernel filesystem instance, with all of its safe mount aliases.
"""
import datetime
import json
import os
import pathlib
import re
import subprocess

PSEUDO_FS = {'tmpfs', 'devtmpfs', 'proc', 'sysfs', 'cgroup', 'cgroup2',
             'squashfs', 'overlay', 'debugfs', 'tracefs', 'securityfs', 'pstore',
             'efivarfs', 'mqueue', 'hugetlbfs', 'fusectl', 'autofs', 'rpc_pipefs',
             'configfs', 'binfmt_misc', 'nsfs', 'ramfs', 'devpts'}
SHARED_FS = {'nfs', 'nfs4', 'cifs', 'smbfs', 'smb3', 'ceph', 'glusterfs',
             'fuse.ceph', 'fuse.glusterfs', 'fuse.sshfs', 'lustre', 'beegfs',
             'gpfs', 'gfs2', 'ocfs2', 'pvfs2'}
TEMP_ROOTS = ('/proc', '/sys', '/dev', '/run', '/tmp', '/var/tmp')
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
KERNEL_DEVICE = re.compile(r'^/dev/(?:[shv]d[a-z]+\d*|xvd[a-z]+\d*|nvme\d+n\d+(?:p\d+)?|dm-\d+|md\d+(?:p\d+)?|mmcblk\d+(?:p\d+)?)$')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def unavailable():
    return {'status': 'unavailable', 'scope': 'sg_master_mounts',
            'checked_at_utc': now(), 'disks': [], 'volumes': [],
            'low_space_filesystems': 0}


def unescape(value):
    return re.sub(r'\\([0-7]{3})', lambda match: chr(int(match.group(1), 8)), value)


def safe_mount(value):
    parts = value.split('/')
    if len(parts) > 2 and parts[1] in ('home', 'root', 'users', 'user'):
        return '/' + parts[1] + '/…'
    if value.startswith('/media/') and len(parts) > 3:
        return '/media/…'
    for index, part in enumerate(parts):
        if part in ('users', 'user') and index + 1 < len(parts):
            return '/'.join(parts[:index + 1]) + '/…'
    return '/'.join('…' if UUID.match(part) else part for part in parts)[:120]


def local_device(source):
    if KERNEL_DEVICE.fullmatch(source):
        return source
    if source.startswith('/dev/'):
        resolved = os.path.realpath(source)
        if KERNEL_DEVICE.fullmatch(resolved):
            return resolved
    return 'Local filesystem'


def mounted_filesystems(text):
    """Return private grouping data; None means identity cannot be established."""
    if not isinstance(text, str) or not text.strip() or len(text) > 4 * 1024 * 1024:
        return None
    groups, targets = {}, {}
    lines = text.splitlines()
    if len(lines) > 8192:
        return None
    for line in lines:
        fields = line.split()
        try:
            separator = fields.index('-')
        except ValueError:
            return None
        if separator < 6 or len(fields) < separator + 4 or not re.fullmatch(r'\d+:\d+', fields[2]):
            return None
        mount, source = unescape(fields[4]), unescape(fields[separator + 2])
        fstype = fields[separator + 1]
        if not mount.startswith('/') or not re.fullmatch(r'[A-Za-z0-9_.-]{1,40}', fstype):
            return None
        if (fstype in PSEUDO_FS or source.startswith('/dev/loop') or
                any(mount == root or mount.startswith(root + '/') for root in TEMP_ROOTS)):
            continue
        key = (fields[2], fstype)
        # A multiply mounted target is ambiguous from df's path alone.
        if mount in targets and targets[mount] != key:
            return None
        targets[mount] = key
        shared = fstype in SHARED_FS or (not source.startswith('/dev/') and (':' in source or source.startswith('//')))
        scope = 'shared' if shared else 'master_local' if source.startswith('/dev/') else 'unclassified'
        device = 'Network volume' if shared else local_device(source)
        flags = fields[5].split(',')
        mode = 'read_only' if 'ro' in flags else 'read_write' if 'rw' in flags else 'unknown'
        group = groups.setdefault(key, {'device': device, 'mounts': [], 'fstype': fstype,
                                       'mount_access': mode, 'scope': scope, '_targets': []})
        if group['mount_access'] != mode:
            group['mount_access'] = 'mixed'
        if group['scope'] != scope:
            group['scope'] = 'unclassified'
            group['device'] = 'Local filesystem'
        if mount not in group['_targets']:
            group['_targets'].append(mount)
        label = safe_mount(mount)
        if label not in group['mounts']:
            group['mounts'].append(label)
    return groups, targets


def capacity(fields):
    if not all(re.fullmatch(r'\d+', value) for value in fields[2:5]):
        return None
    total, used, available = map(int, fields[2:5])
    if total <= 0 or used > total or available > total or used + available > total or used + available <= 0:
        return None
    percent = fields[5]
    if not re.fullmatch(r'\d+%', percent):
        return None
    supplied = int(percent[:-1])
    expected = (100 * used + used + available - 1) // (used + available)
    if supplied != expected or not 0 <= supplied <= 100:
        return None
    return {'total_bytes': total, 'used_bytes': used,
            'available_bytes': available, 'use_percent': supplied}


def normalize(mountinfo_text, df_text, df_ok=True):
    inventory = mounted_filesystems(mountinfo_text)
    if inventory is None:
        return unavailable()
    groups, targets = inventory
    samples, invalid = {}, set()
    malformed = False
    readable = isinstance(df_text, str) and len(df_text) <= 4 * 1024 * 1024
    if readable:
        lines = df_text.splitlines()
        if not lines or not lines[0].startswith('Filesystem'):
            malformed = True
        else:
            for line in lines[1:]:
                if not line.strip():
                    continue
                fields = line.split(None, 6)
                if len(fields) != 7:
                    malformed = True
                    continue
                mount = unescape(fields[6])
                key = targets.get(mount)
                if key is None:
                    continue
                values = capacity(fields)
                if fields[1] != key[1] or values is None:
                    invalid.add(key)
                    continue
                samples.setdefault(key, []).append(values)
    volumes = []
    for key, group in groups.items():
        row = {name: value for name, value in group.items() if not name.startswith('_')}
        values = samples.get(key, [])
        # Different subvolume quotas cannot be represented as one filesystem total.
        consistent = values and len({sample['total_bytes'] for sample in values}) == 1
        if readable and key not in invalid and consistent:
            # df can observe changing counters across aliases; use one whole sample.
            chosen = min(values, key=lambda sample: sample['available_bytes'])
            row.update(chosen, status='mounted')
            free, total = chosen['available_bytes'], chosen['total_bytes']
            row['space_status'] = ('full' if free == 0 else 'low' if
                                   free / total < .10 or (total >= 20_000_000_000 and free < 20_000_000_000)
                                   else 'ok')
        else:
            row.update(status='usage_unknown', total_bytes=None, used_bytes=None,
                       available_bytes=None, use_percent=None, space_status='unknown')
        volumes.append(row)
    partial = not df_ok or not readable or malformed or any(row['status'] != 'mounted' for row in volumes)
    return {'status': 'partial' if partial else 'ok', 'scope': 'sg_master_mounts',
            'checked_at_utc': now(), 'disks': [], 'volumes': volumes,
            'low_space_filesystems': sum(row['space_status'] in ('low', 'full') for row in volumes)}


def run_df():
    try:
        result = subprocess.run(['df', '-P', '-T', '-B1'], capture_output=True,
                                text=True, timeout=8,
                                env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LC_ALL': 'C'})
        return result.returncode == 0, result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False, ''


def main():
    try:
        mountinfo = pathlib.Path('/proc/self/mountinfo').read_text()
    except (OSError, UnicodeError):
        mountinfo = ''
    if mounted_filesystems(mountinfo) is None:
        result = unavailable()
    else:
        ok, output = run_df()
        result = normalize(mountinfo, output, ok)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
