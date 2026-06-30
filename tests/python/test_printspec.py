import json
from pathlib import Path
from printspec import *
root=Path(__file__).resolve().parents[2]
def read(p): return json.loads((root/p).read_text())
spec=read(Path('examples/part-families/rounded-rectangular-plate.basic.json'))
project=read(Path('examples/projects/simple-enclosure-project.json'))
def test_shared_valid_fixtures_pass():
    for f in (root/'tests/fixtures/valid').glob('*.json'):
        r=validate_printspec(json.loads(f.read_text())); assert r['valid'], f"{f.name}: {r['errors']}"
def test_shared_invalid_fixtures_fail():
    for f in (root/'tests/fixtures/invalid').glob('*.json'):
        assert not validate_printspec(json.loads(f.read_text()))['valid'], f.name
def test_validation_and_models():
    assert validate_printspec(spec)['valid']
    from printspec.models import PrintSpec
    assert PrintSpec(**spec).units == 'mm'
def test_bom_helpers():
    bom=extract_bom(project); assert bom[0]['quantity']==4
    assert 'lid_screws' in bom_to_markdown(bom)
    assert '91292A112' in bom_to_csv(bom)
    assert 'mcmaster' in bom_to_supplier_order_list(bom)
def test_generators():
    assert generate_openscad(spec)['code']==generate_openscad(spec)['code']
    cq=generate_cadquery(spec)['code']; assert 'part =' in cq and 'export' not in cq and 'subprocess' not in cq
    bad=json.loads(json.dumps(spec)); bad['part']['parameters']['cornerRadius']=999
    assert not generate_openscad(bad)['supported'] and 'Validation failed' in generate_openscad(bad)['message']
