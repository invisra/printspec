import json
from pathlib import Path
from printspec import *
root=Path(__file__).resolve().parents[2]
spec=json.loads((root/'examples/part-families/rounded-rectangular-plate.basic.json').read_text())
project=json.loads((root/'examples/projects/simple-enclosure-project.json').read_text())
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
    cq=generate_cadquery(spec)['code']; assert 'part =' in cq and 'export' not in cq
    bad=json.loads(json.dumps(spec)); bad['part']['type']='round_spacer'
    assert not generate_openscad(bad)['supported'] and 'Unsupported' in generate_openscad(bad)['message']
