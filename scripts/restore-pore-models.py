"""Restore audited NU-100 and MOF-177 display records without inferring new geometry."""
import copy, hashlib, itertools, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'data/mof-unit-cells.json'
gallery=json.loads(path.read_text())
catalog=json.loads((ROOT/'data/mof-catalog.json').read_text())
registry=json.loads((ROOT/'data/mof-sources.json').read_text())['structures']
ids=['mof-177','nu-100']
gallery['models']=[m for m in gallery['models'] if m['id'] not in ids]
for slug in ids:
    original=next(m for m in catalog if m['slug']==slug)
    source=next(m for m in registry if m['slug']==slug)
    assert hashlib.sha256((ROOT/original['download_url']).read_bytes()).hexdigest()==original['source_sha256']
    cell=original['cell_vectors']
    model={
        'id':slug, 'name':original['name'], 'units':original['units'],
        'source_url':original['source_url'], 'source_sha256':original['source_sha256'],
        'cif_path':original['download_url'], 'poster_path':f'images/mofs/{slug}.svg',
        'cell':original['cell_parameters'], 'cell_vectors':copy.deepcopy(cell),
        'cell_vertices':[[sum(signs[k]*cell[k][i]/2 for k in range(3)) for i in range(3)] for signs in itertools.product([-1,1],repeat=3)],
        'cell_edges':[[i,j] for i in range(8) for j in range(i+1,8) if (i^j) in [1,2,4]],
        'atoms':copy.deepcopy(original['atoms']), 'bonds':[],
        'bond_segments':copy.deepcopy(original['bond_segments']),
        'license':source['license'], 'verification':source['expected'],
        'representation_source':{'path':'data/mof-catalog.json','slug':slug,'method':'Retain every source atom and colored clipped bond segment exactly; no new bond inference.'},
        'display_note':original['display_note'],
        'display_view':{'direction':'[001]','front':copy.deepcopy(cell[2]),'up':copy.deepcopy(cell[1]),
          'initial_yaw':0,'yaw_amplitude':.12,'period_seconds':32,
          'note':'Restore the audited [001] pore-facing unit-cell view without pitch or roll. Source coordinates and periodic clipped bond segments are unchanged.'}
    }
    gallery['models'].append(model)
    print(slug,len(model['atoms']),'atoms;',len(model['bond_segments']),'retained colored bond segments')
path.write_text(json.dumps(gallery,separators=(',',':'))+'\n')
