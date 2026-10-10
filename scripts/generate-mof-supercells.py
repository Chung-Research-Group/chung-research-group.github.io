"""Build visualization-only supercells by rigid lattice translations.
No bond inference, structure optimization or pore-size calculation is performed.
"""
import copy, itertools, json, math
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'data/mof-unit-cells.json').read_text())
publications = json.loads((ROOT / 'data/mof-publications.json').read_text())
provenance = {'purpose': 'Periodic supercell visualization only; no relaxation or pore-size calculation.', 'models': {}}
for model in source['models']:
    model['publication'] = publications[model['id']]
    base = copy.deepcopy(model)
    cell = model['cell_vectors']
    repeats = [1, 2, 2] if model['id'] == 'calf-20' else [1, 1, 1]
    dot = lambda x, y: sum(a*b for a,b in zip(x,y))
    cross = lambda a,b: [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
    if model['id'] in ['mg-mof-74', 'nu-1000', 'mof-177']:
        view = model['display_view']
        view['unrotated_up'] = copy.deepcopy(view['up'])
        front_length = math.hypot(*view['front'])
        view['up'] = cross([v/front_length for v in view['front']], view['up'])
        view['screen_rotation_degrees_clockwise'] = 90
        view['note'] = view['note'].replace('no roll or pitch', 'no out-of-plane tilt').replace('without pitch or roll', 'without out-of-plane tilt')
        view['note'] += ' Fixed 90-degree clockwise screen orientation preserves the pore-facing direction and exact lattice geometry.'
    volume = dot(cell[0],cross(cell[1],cell[2]))
    reciprocal = [cross(cell[1],cell[2]), cross(cell[2],cell[0]), cross(cell[0],cell[1])]
    frac = lambda p: [dot(p,r)/volume for r in reciprocal]
    inside = lambda p: all(abs(v) <= n/2 + 1e-6 for v,n in zip(frac(p),repeats))
    atoms, bonds, index, bondkeys = [], [], {}, set()
    def add(element, p):
        key = (element, *(round(v,5) for v in p))
        if key not in index:
            index[key] = len(atoms)
            atoms.append([element,*p,0 if inside(p) else 1])
        return index[key]
    if repeats == [1, 1, 1]:
        # Keep the approved pore-centered unit-cell representation exactly.
        atoms, bonds = base['atoms'], base['bonds']
    else:
        # A centered even repeat changes only the display origin by half a lattice
        # vector. Every copy is an exact lattice translation of this shared origin.
        for tile in itertools.product(*(range(n) for n in repeats)):
            offset = [sum((tile[k]-(repeats[k]-1)/2)*cell[k][i] for k in range(3)) for i in range(3)]
            shifted = [(a[0],[a[i+1]+offset[i] for i in range(3)]) for a in base['atoms']]
            for element,p in shifted:
                if inside(p): add(element,p)
            for u,v,*_ in base['bonds']:
                e,p = shifted[u]; f,q = shifted[v]
                if not (inside(p) or inside(q)): continue
                i,j = add(e,p),add(f,q); key=tuple(sorted((i,j)))
                if key not in bondkeys:
                    bondkeys.add(key); bonds.append([i,j,0 if inside(p) and inside(q) else 1])
    lengths = [math.dist(base['atoms'][i][1:4],base['atoms'][j][1:4]) for i,j,*_ in base['bonds']]
    error = max((min(abs(math.dist(atoms[i][1:4],atoms[j][1:4])-length) for length in lengths) for i,j,*_ in bonds), default=0)
    if error > 2e-5: raise ValueError(f"{model['id']}: bond-length mismatch {error}")
    model['atoms'],model['bonds']=atoms,bonds
    model['unit_cell_vertices']=base['cell_vertices']
    model['cell_vertices']=[[sum(signs[k]*repeats[k]*cell[k][i]/2 for k in range(3)) for i in range(3)] for signs in itertools.product([-1,1],repeat=3)]
    model['cell_edges']=[[i,j] for i in range(8) for j in range(i+1,8) if (i^j) in [1,2,4]]
    if repeats == [1, 1, 1]:
        model['cell_vertices'], model['cell_edges'] = base['cell_vertices'], base['cell_edges']
    model.pop('original_representation',None)
    model['supercell']={'repeats':repeats,'source':'data/mof-unit-cells.json','display_origin_translation_fractional':[-(n-1)/2 for n in repeats], 'atom_count':len(atoms),'bond_count':len(bonds),'clipped_bond_segment_count':len(model.get('bond_segments',[])),'max_bond_length_error_angstrom':error}
    model['display_view']['note'] += (' CALF-20 repeats exact lattice geometry across the pore plane.'
        if repeats != [1, 1, 1] else ' A single unit cell keeps the pore aperture prominent.')
    provenance['models'][model['id']]={**model['supercell'],'view':model['display_view'],'unit_cell_vectors_angstrom':cell}
    print(model['id'],repeats,len(atoms),len(bonds),'bond error',error)
(ROOT/'data/mof-gallery.json').write_text(json.dumps(source,separators=(',',':'))+'\n')
(ROOT/'data/mof-supercell-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
