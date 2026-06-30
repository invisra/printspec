import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'packages/python'))
from printspec import validate_printspec
root=Path(__file__).resolve().parents[2]
for p in list((root/'examples').rglob('*.json')):
    spec=json.loads(p.read_text()); r=validate_printspec(spec); assert r['valid'], (p,r)
valid=json.loads((root/'examples/part-families/rounded-rectangular-plate.basic.json').read_text())
for mutate in ['negative','missing','unknown','supplier']:
    bad=json.loads(json.dumps(valid))
    if mutate=='negative': bad['part']['parameters']['length']=-1
    if mutate=='missing': del bad['part']['label']
    if mutate=='unknown': bad['part']['type']='weapon_mount'
    if mutate=='supplier': bad['hardware']=[{'id':'x','kind':'screw','quantity':1,'supplierReferences':[{'supplier':'x','partNumber':'y','url':'not a url'}]}]
    assert not validate_printspec(bad)['valid'], mutate
