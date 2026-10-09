# SPDX-License-Identifier: GPL-3.0-only
"""Recreate canonical CIFs from the checked-in source files.

Requires numpy==2.4.4. Use --check to verify without modifying files.
The CALF-20 component follows its upstream GPLv3 license; sources and the
complete license are distributed in data/mof-source and data/mof-licenses.
"""
from pathlib import Path
import hashlib
import json
import math
import re
import argparse
from collections import Counter

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / 'data' / 'mof-source'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='Verify normalized bytes and hashes without writing.')
CHECK = parser.parse_args().check


def canonical(path, text):
    # Explicit CRLF retains the approved CIF bytes on every operating system.
    payload = text.replace('\n', '\r\n').encode('utf-8')
    if CHECK:
        if path.read_bytes() != payload:
            raise ValueError(f'Canonical CIF differs from its retained source: {path.name}')
    else:
        path.write_bytes(payload)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# The original ACS CIF terminates with an empty loop_ directive. Remove that
# invalid trailing token only; preserve its cell, atom sites and symmetry.
raw_nu = INPUT / 'nu-1000-original.cif'
nu_text = raw_nu.read_text(encoding='utf-8').rstrip()
assert nu_text.endswith('loop_')
nu_text = nu_text[:-5].rstrip() + '\n'
canonical(INPUT / 'nu-1000.cif', nu_text)


# CALF-20: the publication repository stores a fully periodic 3x3x3 alpha-phase
# structure in LAMMPS restricted-triclinic format, units metal => Angstrom.
# Recover the original 44-atom periodic cell without relaxing or moving atoms.
calf_source = INPUT / 'calf-20-original.lmp'
calf_lines = calf_source.read_text(encoding='utf-8').splitlines()
box = {}
for line in calf_lines:
    tokens = line.split()
    if len(tokens) == 4 and tokens[-2:] in [['xlo', 'xhi'], ['ylo', 'yhi'], ['zlo', 'zhi']]:
        box[tokens[-2][0]] = float(tokens[1]) - float(tokens[0])
    if tokens[-3:] == ['xy', 'xz', 'yz']:
        box['xy'], box['xz'], box['yz'] = map(float, tokens[:3])
matrix = np.array([[box['x'], 0, 0], [box['xy'], box['y'], 0],
                   [box['xz'], box['yz'], box['z']]], dtype=float) / 3
inv = np.linalg.inv(matrix)
start = calf_lines.index('Atoms') + 1
site_rows = []
for line in calf_lines[start:]:
    if not line.strip():
        continue
    fields = line.split()
    if not fields[0].isdigit():
        break
    site_rows.append((int(fields[2]), np.array(list(map(float, fields[4:7]))) @ inv))
assert len(site_rows) == 1188
species = {1: 'Zn', 2: 'N', 3: 'O', 4: 'C', 5: 'H'}
unique = []
counts = []
max_fold_error = 0.0
for atom_type, frac in site_rows:
    frac = frac % 1
    found = None
    for j, (existing_type, existing_frac) in enumerate(unique):
        if atom_type != existing_type:
            continue
        delta = frac - existing_frac
        delta -= np.rint(delta)
        err = np.linalg.norm(delta @ matrix)
        if err < 1e-5:
            found = j
            max_fold_error = max(max_fold_error, err)
            break
    if found is None:
        unique.append((atom_type, frac))
        counts.append(1)
    else:
        counts[found] += 1
assert len(unique) == 44, len(unique)
assert set(counts) == {27}, set(counts)
lengths = np.linalg.norm(matrix, axis=1)
angles = [math.degrees(math.acos(np.dot(matrix[u], matrix[v]) / (lengths[u] * lengths[v])))
          for u, v in [(1, 2), (0, 2), (0, 1)]]
cif = [
    'data_CALF20_alpha_publication_model',
    "_audit_creation_method 'Exact periodic folding of publication LAMMPS structure'",
    "_audit_source 'https://github.com/shm-phy/GK_CALF-20/blob/main/MLP-MD/data_alpha_CALF-20.lmp'",
    "_symmetry_space_group_name_H-M 'P 1'", '_symmetry_Int_Tables_number 1',
]
for suffix, value in zip(['length_a', 'length_b', 'length_c', 'angle_alpha', 'angle_beta', 'angle_gamma'], [*lengths, *angles]):
    cif.append(f'_cell_{suffix} {value:.10f}')
cif += ['loop_', '_symmetry_equiv_pos_as_xyz', "'x,y,z'", 'loop_',
        '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x',
        '_atom_site_fract_y', '_atom_site_fract_z', '_atom_site_occupancy']
for j, (atom_type, frac) in enumerate(unique, 1):
    element = species[atom_type]
    cif.append(f'{element}{j} {element} ' + ' '.join(f'{x:.10f}' for x in frac) + ' 1.0')
canonical(INPUT / 'calf-20.cif', '\n'.join(cif) + '\n')


registry = json.loads((ROOT / 'data/mof-sources.json').read_text(encoding='utf-8'))
for entry in registry['structures']:
    for path_key, hash_key in [('path', 'sha256'), ('raw_source_path', 'raw_source_sha256')]:
        if path_key in entry and sha(ROOT / entry[path_key]) != entry[hash_key]:
            raise ValueError(f"Source hash mismatch for {entry['slug']}: {entry[path_key]}")
print(json.dumps({'canonical_source_hashes': 'passed', 'calf_unique_atoms': len(unique),
    'calf_copies_per_atom': sorted(set(counts)), 'calf_max_fold_error_angstrom': max_fold_error}))
