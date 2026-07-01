import json, subprocess, sys
from pathlib import Path
from printspec import *
root=Path(__file__).resolve().parents[2]
def read(p): return json.loads((root/p).read_text())
def norm(s): return '\n'.join(line.rstrip() for line in s.replace('\r\n','\n').split('\n')).rstrip()+'\n'
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

def test_package_local_schema_resources_exist():
    from importlib.resources import files

    schema_dir = files("printspec").joinpath("schemas")
    assert schema_dir.is_dir()
    assert schema_dir.joinpath("printspec.schema.json").is_file()
    assert schema_dir.joinpath("common.schema.json").is_file()
    assert validate_printspec(spec)["valid"]

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
def test_generator_snapshots_match_fixtures():
    items=[('rounded-rectangular-plate.basic','examples/part-families/rounded-rectangular-plate.basic.json'),('spacer-block.four-hole','examples/part-families/spacer-block.four-hole.json'),('round-spacer.basic','examples/part-families/round-spacer.basic.json'),('electronics-standoff.m3','examples/part-families/electronics-standoff.m3.json')]
    for name,file in items:
        s=read(Path(file))
        assert norm(generate_openscad(s)['code'])==norm((root/f'tests/fixtures/generated/openscad/{name}.scad').read_text())
        assert norm(generate_cadquery(s)['code'])==norm((root/f'tests/fixtures/generated/cadquery/{name}.py').read_text())
def test_warning_behavior():
    s=read(Path('examples/part-families/round-spacer.basic.json')); s['part']['parameters']['fillet']={'radius':0.25}
    assert generate_cadquery(s)['warnings']==['fillet requested but not implemented']
def test_python_cli_commands():
    env=None
    for args in [['validate','examples/part-families/rounded-rectangular-plate.basic.json'],['to-openscad','examples/part-families/round-spacer.basic.json'],['to-cadquery','examples/part-families/electronics-standoff.m3.json'],['bom','examples/projects/simple-enclosure-project.json','--format','markdown']]:
        r=subprocess.run([sys.executable,'-m','printspec.cli',*args],cwd=root,text=True,capture_output=True,env=env)
        assert r.returncode==0, args + [r.stderr]
        assert r.stdout or r.stderr
    bad=subprocess.run([sys.executable,'-m','printspec.cli','validate','tests/fixtures/invalid/round-spacer-inner-too-large.json'],cwd=root,text=True,capture_output=True,env=env)
    assert bad.returncode==1 and 'invalid' in bad.stderr
