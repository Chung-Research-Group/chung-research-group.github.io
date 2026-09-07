"""Expand the downloaded RASPA CIF exactly; no coordinates are invented.

This deliberately handles only the syntax present in this specific source CIF.
All symmetry arithmetic is exact Fraction arithmetic before Cartesian conversion.
"""
from pathlib import Path
from fractions import Fraction
from collections import Counter, defaultdict
import hashlib
import json
import re
import math

ROOT = Path(__file__).resolve().parents[1] / 'data'
source = ROOT / 'irmof-1.cif'
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'e5d0b3d72445c15cd2ed02a36fa2fdf3d5d13f6c21441984475449d48d3f0ad2'
lines = source.read_text().splitlines()
cell = float(next(x.split()[1] for x in lines if x.startswith('_cell_length_a ')))
symmetry_start = lines.index('_symmetry_equiv_pos_as_xyz') + 1
ops = []
for line in lines[symmetry_start:]:
    if not line.strip():
        break
    ops.append(line.strip().strip("'").split(','))

sites = []
for line in lines[lines.index('_atom_site_charge') + 1:]:
    if not line.strip():
        continue
    label, element, x, y, z, charge = line.split()
    sites.append((label, element, tuple(map(Fraction, (x, y, z)))))

def evaluate(term, xyz):
    match = re.fullmatch(r'(-?)([xyz])(?:\+(1/2))?', term)
    if not match:
        raise ValueError(f'Unrecognized operation {term!r}')
    sign, axis, offset = match.groups()
    return ((-1 if sign else 1) * xyz['xyz'.index(axis)] +
            (Fraction(offset) if offset else 0)) % 1

atoms = []
multiplicities = {}
for label, element, xyz in sites:
    equivalent = sorted({tuple(evaluate(term, xyz) for term in op) for op in ops})
    multiplicities[label] = len(equivalent)
    for point in equivalent:
        frac = list(map(float, point))
        atoms.append({'id': len(atoms), 'element': element, 'source_site': label,
                      'fractional': frac,
                      'cartesian': [round(value * cell, 8) for value in frac]})

counts = dict(Counter(atom['element'] for atom in atoms))
assert counts == {'Zn': 32, 'O': 104, 'C': 192, 'H': 96}, counts
assert len(ops) == 192
assert len({tuple(a['fractional']) for a in atoms}) == 424

# Rendering bonds are distance-inferred, not explicitly recorded in the CIF.
# Restrict to chemically relevant element pairs; verify full periodic coordination.
cutoffs = {('O', 'Zn'): 2.3, ('C', 'O'): 1.6,
           ('C', 'C'): 1.7, ('C', 'H'): 1.2}
frac = [a['fractional'] for a in atoms]
bonds = []
degrees = Counter()
bond_lengths = defaultdict(list)
minimum_distance = float('inf')
for i in range(len(atoms)):
    for j in range(i + 1, len(atoms)):
        delta = [b - a for a, b in zip(frac[i], frac[j])]
        shift = [-round(d) for d in delta]
        distance = math.sqrt(sum(((d + t) * cell)**2 for d, t in zip(delta, shift)))
        minimum_distance = min(minimum_distance, distance)
        pair = tuple(sorted((atoms[i]['element'], atoms[j]['element'])))
        if 0.3 < distance < cutoffs.get(pair, 0):
            bonds.append({'i': i, 'j': j, 'j_cell_shift': shift,
                          'distance': round(distance, 8)})
            degrees[i] += 1
            degrees[j] += 1
            bond_lengths['-'.join(pair)].append(distance)
expected_degrees = {'Zn1': 4, 'O1': 4, 'O2': 2, 'C1': 3, 'C2': 3, 'C3': 3, 'H1': 1}
assert all(degrees[a['id']] == expected_degrees[a['source_site']] for a in atoms)
assert len(bonds) == 512

sha = '6498ab1eec9c8e0f063dcd0d71dd7add372c529b'
payload = {
    'name': 'MOF-5 (IRMOF-1)',
    'source_url': f'https://raw.githubusercontent.com/iRASPA/RASPA2/{sha}/structures/mofs/cif/IRMOF-1.cif',
    'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'units': 'angstrom',
    'cell': {'a': cell, 'b': cell, 'c': cell, 'alpha': 90, 'beta': 90, 'gamma': 90},
    'space_group': {'hm': 'F m -3 m', 'hall': '-F 4 2 3', 'number': 225},
    'symmetry_operation_count': len(ops),
    'asymmetric_site_multiplicities': multiplicities,
    'formula_unit': 'C24H12O13Zn4',
    'formula_unit_structural': 'Zn4O(C8H4O4)3',
    'formula_units_per_conventional_cell': 8,
    'atom_counts': counts,
    'atoms': atoms,
    'bonds': bonds,
    'bond_note': 'Distance-inferred rendering bonds; j_cell_shift is the lattice translation of atom j relative to atom i. Bond orders are not assigned.',
    'verification': {
        'unique_atom_count': len(atoms),
        'minimum_periodic_interatomic_distance_angstrom': minimum_distance,
        'bond_count': len(bonds),
        'periodic_coordination_verified': expected_degrees,
        'bond_distance_ranges_angstrom': {k: {'count': len(v), 'min': min(v), 'max': max(v)} for k, v in bond_lengths.items()},
    },
}

# Keep one conventional cell plus correct image endpoints of boundary bonds.
# H atoms are omitted for clarity; no long bonds across wrapped coordinates.
display_atoms, display_bonds, lookup = [], [], {}
def endpoint(atom_id, shift=(0, 0, 0)):
    key = (atom_id, *shift)
    if key not in lookup:
        atom = atoms[atom_id]
        lookup[key] = len(display_atoms)
        display_atoms.append([atom['element'], *[
            round(value + (image - 0.5) * cell, 6)
            for value, image in zip(atom['cartesian'], shift)]])
    return lookup[key]
for atom in atoms:
    if atom['element'] != 'H': endpoint(atom['id'])
for bond in bonds:
    i, j, shift = bond['i'], bond['j'], tuple(bond['j_cell_shift'])
    if atoms[i]['element'] == 'H' or atoms[j]['element'] == 'H': continue
    display_bonds.append([endpoint(i), endpoint(j, shift)])
    if any(shift):
        display_bonds.append([endpoint(j), endpoint(i, tuple(-x for x in shift))])
model = {key: payload[key] for key in ['name', 'source_url', 'source_sha256', 'units', 'cell', 'formula_unit_structural', 'atom_counts', 'verification']}
model.update(atoms=display_atoms, bonds=display_bonds,
             display_note='Hydrogens omitted. Centered conventional cell with periodic image endpoints; distance-inferred bonds without bond orders.')
(ROOT / 'irmof-1.json').write_text(json.dumps(model, separators=(',', ':')) + '\n')
print(f'Verified {len(atoms)} unit-cell atoms, {len(bonds)} periodic bonds; rendered {len(display_atoms)} atoms and {len(display_bonds)} bonds.')
