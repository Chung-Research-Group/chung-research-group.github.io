# SPDX-License-Identifier: GPL-3.0-only
"""Generate the homepage MOF catalog from retained, attributed CIFs.

Requires numpy==2.4.4 and gemmi==0.7.5. No network or simulation is used.
Use --check to compare the existing catalog with reproduced geometry.
The component licenses are recorded in data/mof-sources.json.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import math
from collections import Counter
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[1]
import gemmi
import numpy as np

EPS = 1e-9
RADII = {'C': .76, 'N': .71, 'O': .66}
METALS = {'Cu', 'Zn', 'Mg', 'Zr'}


def cutoff(a, b):
    if a in METALS and b in {'O', 'N'} or b in METALS and a in {'O', 'N'}:
        return 2.65 if 'Zr' in {a, b} else 2.5
    if a in METALS or b in METALS or (a == b == 'O'):
        return 0
    return 1.2 * (RADII.get(a, .7) + RADII.get(b, .7))


def clip(a, b):
    """Slab clip in fractional space; preserve the actual oblique cell."""
    delta = b - a
    lo, hi = 0., 1.
    for axis in range(3):
        if abs(delta[axis]) < EPS:
            if a[axis] < -EPS or a[axis] > 1 + EPS:
                return None
        else:
            t0, t1 = -a[axis] / delta[axis], (1 - a[axis]) / delta[axis]
            lo, hi = max(lo, min(t0, t1)), min(hi, max(t0, t1))
            if lo > hi - EPS:
                return None
    return np.clip(a + lo * delta, 0, 1), np.clip(a + hi * delta, 0, 1)


def periodic_segments(a, b):
    bounds = [range(math.ceil(-max(a[d], b[d]) - EPS),
                    math.floor(1 - min(a[d], b[d]) + EPS) + 1) for d in range(3)]
    seen = set()
    for shift in itertools.product(*bounds):
        endpoints = clip(a + shift, b + shift)
        if endpoints is None:
            continue
        p, q = endpoints
        key = tuple(sorted((tuple(np.round(p, 9)), tuple(np.round(q, 9)))))
        if key not in seen:
            seen.add(key)
            yield p, q


def read_structure(path):
    structure = gemmi.make_small_structure_from_block(gemmi.cif.read_file(str(path)).sole_block())
    cell = structure.cell
    lattice = np.array([list(cell.orthogonalize(gemmi.Fractional(*p)))
                        for p in np.eye(3)], dtype=float)
    records, seen = [], set()
    for atom in structure.get_all_unit_cell_sites():
        if atom.element.name == 'H':
            continue
        if atom.occ < .999:
            raise ValueError(f'Partial occupancy needs explicit treatment: {path}: {atom.label}')
        f = np.array(list(atom.fract)) % 1
        f[np.isclose(f, 1, atol=1e-7) | np.isclose(f, 0, atol=1e-7)] = 0
        key = (atom.element.name, *np.round(f, 7))
        if key not in seen:
            seen.add(key)
            records.append((atom.element.name, f))
    records.sort(key=lambda r: (r[0], *r[1]))
    return structure, lattice, records


def build(entry):
    path = ROOT / entry['path']
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
        raise ValueError(f"Source hash mismatch: {entry['slug']}")
    structure, lattice, records = read_structure(path)
    elements = [r[0] for r in records]
    frac = np.array([r[1] for r in records])
    n = len(records)
    center = np.sum(lattice, axis=0) / 2
    cart = frac @ lattice
    limits = np.array([[cutoff(a, b) for b in elements] for a in elements])
    # Reciprocal-plane heights bound all translations that can lie inside a cutoff.
    heights = 1 / np.linalg.norm(np.linalg.inv(lattice), axis=0)
    image_range = np.ceil(limits.max() / heights).astype(int)
    graph, degrees = [], np.zeros(n, dtype=int)
    for shift in itertools.product(*(range(-k, k + 1) for k in image_range)):
        delta = cart[None, :, :] + np.array(shift) @ lattice - cart[:, None, :]
        distance2 = np.sum(delta * delta, axis=2)
        ii, jj = np.where(np.triu((distance2 <= limits ** 2) & (distance2 > .65 ** 2), k=1))
        for i, j in zip(ii.tolist(), jj.tolist()):
            graph.append((i, j, shift, math.sqrt(distance2[i, j])))
            degrees[i] += 1
            degrees[j] += 1
    segments, segment_keys = [], set()
    total_crossing, inside_max_error = 0, 0.
    for i, j, shift, length in graph:
        a, b = frac[i], frac[j] + shift
        mid = (a + b) / 2
        total_crossing += any(shift)
        for element, p, q in [(elements[i], a, mid), (elements[j], mid, b)]:
            for first, second in periodic_segments(p, q):
                inside_max_error = max(inside_max_error, float(np.maximum(-first, first - 1).max()),
                                       float(np.maximum(-second, second - 1).max()))
                ca, cb = first @ lattice - center, second @ lattice - center
                assert np.linalg.norm(cb - ca) <= length / 2 + 1e-6
                key = (element, *sorted((tuple(np.round(ca, 6)), tuple(np.round(cb, 6)))))
                if key not in segment_keys:
                    segment_keys.add(key)
                    segments.append([element, *np.round(ca, 6).tolist(), *np.round(cb, 6).tolist()])
    # Deliberate copies only for atomic sites exactly on a cell face/edge/corner.
    atoms = []
    for element, f in records:
        shifts = [[0, 1] if abs(x) < 1e-7 else [0] for x in f]
        for shift in itertools.product(*shifts):
            p = (f + shift) @ lattice - center
            atoms.append([element, *np.round(p, 6).tolist()])
    cell = structure.cell
    model = {'name': entry['name'], 'slug': entry['slug'], 'source_url': entry['url'],
             'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'units': 'angstrom',
             'download_url': entry['download_url'],
             'cell_parameters': [cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma],
             'cell_vectors': np.round(lattice, 9).tolist(),
             'atoms': atoms, 'bond_segments': segments,
             'display_note': 'Full crystallographic cell. Hydrogen atoms omitted. Distance-inferred connectivity; no formal bond orders. Periodic bonds clipped to the actual fractional cell.'}
    # Lattice checks are independent of the rendering implementation.
    lengths = np.linalg.norm(lattice, axis=1)
    angles = [math.degrees(math.acos(np.clip(np.dot(lattice[i], lattice[j]) / lengths[i] / lengths[j], -1, 1)))
              for i, j in [(1, 2), (0, 2), (0, 1)]]
    errors = {'length_angstrom': float(np.max(np.abs(lengths - [cell.a, cell.b, cell.c]))),
              'angle_degree': float(np.max(np.abs(np.array(angles) - [cell.alpha, cell.beta, cell.gamma]))),
              'fractional_boundary': max(0, inside_max_error)}
    assert errors['length_angstrom'] < 1e-7 and errors['angle_degree'] < 1e-6
    assert np.linalg.det(lattice) > 0
    assert len(graph) > 0 and np.all(degrees > 0), f'Disconnected atoms: {entry["name"]}'
    validation = {'name': entry['name'], 'slug': entry['slug'], 'unit_cell_atoms_without_H': n,
                  'display_atoms_including_face_images': len(atoms), 'composition_without_H': dict(Counter(elements)),
                  'cell_parameters': model['cell_parameters'], 'volume_angstrom3': float(np.linalg.det(lattice)),
                  'inferred_bonds': len(graph), 'periodic_bonds': total_crossing,
                  'colored_clipped_segments': len(segments), 'errors': errors,
                  'metal_coordination_counts': {e: dict(Counter(int(degrees[i]) for i, x in enumerate(elements) if x == e))
                                                for e in sorted(set(elements) & METALS)}}
    for key, expected in entry['expected'].items():
        if validation[key] != expected:
            raise ValueError(f"Approved geometry changed: {entry['slug']}: {key}")
    return model, validation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify the catalog without writing.')
    args = parser.parse_args()
    registry = json.loads((ROOT / 'data/mof-sources.json').read_text(encoding='utf-8'))
    entries = registry['structures'] if isinstance(registry, dict) else registry
    models, checks = [], []
    for entry in entries:
        model, check = build(entry)
        models.append(model)
        checks.append(check)
        print(json.dumps(check))
    # Generic PBC-crossing example: parts on opposing faces conserve bond length.
    first, second = np.array([.94, .4, .4]), np.array([1.06, .4, .4])
    parts = list(periodic_segments(first, second))
    assert len(parts) == 2
    assert abs(sum(np.linalg.norm(b - a) for a, b in parts) - .12) < 1e-10
    output = ROOT / 'data/mof-catalog.json'
    payload = (json.dumps(models, separators=(',', ':')) + '\n').encode('utf-8')
    if args.check:
        if json.loads(output.read_text(encoding='utf-8')) != models:
            raise ValueError('The checked-in catalog differs from reproduced geometry or metadata.')
    else:
        output.write_bytes(payload)
    print(json.dumps({'catalog_sha256': hashlib.sha256(payload).hexdigest(),
        'generic_cross_face_length_conservation': 'passed', 'parser': f'gemmi {gemmi.__version__}',
        'structures': len(checks)}))


if __name__ == '__main__':
    main()
