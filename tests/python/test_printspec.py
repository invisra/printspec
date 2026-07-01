import json, os, subprocess, sys
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
    env={**os.environ,'PYTHONPATH':'packages/python'}
    for args in [['validate','examples/part-families/rounded-rectangular-plate.basic.json'],['to-openscad','examples/part-families/round-spacer.basic.json'],['to-cadquery','examples/part-families/electronics-standoff.m3.json'],['bom','examples/projects/simple-enclosure-project.json','--format','markdown']]:
        r=subprocess.run([sys.executable,'-m','printspec.cli',*args],cwd=root,text=True,capture_output=True,env=env)
        assert r.returncode==0, args + [r.stderr]
        assert r.stdout or r.stderr
    bad=subprocess.run([sys.executable,'-m','printspec.cli','validate','tests/fixtures/invalid/round-spacer-inner-too-large.json'],cwd=root,text=True,capture_output=True,env=env)
    assert bad.returncode==1 and 'invalid' in bad.stderr
    malformed = root / 'tests/fixtures/invalid-json.tmp.json'
    malformed.write_text('{bad json')
    try:
        r=subprocess.run([sys.executable,'-m','printspec.cli','validate',str(malformed)],cwd=root,text=True,capture_output=True,env=env)
        assert r.returncode == 1
        assert 'invalid-json.tmp.json' in r.stderr
        assert 'parse error' in r.stderr
    finally:
        malformed.unlink(missing_ok=True)

def test_python_cli_version_commands():
    for args in [['--version'], ['version']]:
        r = subprocess.run([sys.executable, '-m', 'printspec.cli', *args], cwd=root, text=True, capture_output=True, env={**os.environ,'PYTHONPATH':'packages/python'})
        assert r.returncode == 0
        assert 'printspec 0.1.0' in r.stdout


def test_python_cli_friendly_user_errors(tmp_path):
    env={**os.environ,'PYTHONPATH':'packages/python'}
    help_result=subprocess.run([sys.executable,'-m','printspec.cli','--help'],cwd=root,text=True,capture_output=True,env=env)
    assert help_result.returncode == 0
    assert 'usage: printspec' in help_result.stdout

    bad_command=subprocess.run([sys.executable,'-m','printspec.cli','wat'],cwd=root,text=True,capture_output=True,env=env)
    assert bad_command.returncode == 1
    assert 'invalid choice' in bad_command.stderr or 'error:' in bad_command.stderr
    assert 'Traceback' not in bad_command.stderr

    missing=subprocess.run([sys.executable,'-m','printspec.cli','validate','does-not-exist.json'],cwd=root,text=True,capture_output=True,env=env)
    assert missing.returncode == 1
    assert 'does-not-exist.json' in missing.stderr
    assert 'read error' in missing.stderr
    assert 'Traceback' not in missing.stderr

    malformed=tmp_path/'invalid-json.tmp.json'
    malformed.write_text('{bad json', encoding='utf8')
    invalid=subprocess.run([sys.executable,'-m','printspec.cli','validate',str(malformed)],cwd=root,text=True,capture_output=True,env=env)
    assert invalid.returncode == 1
    assert 'invalid-json.tmp.json' in invalid.stderr
    assert 'parse error' in invalid.stderr
    assert 'Traceback' not in invalid.stderr

def test_python_form_metadata_helpers_and_cli():
    from printspec import get_part_family_form_metadata, list_part_families
    families=list_part_families()
    assert any(f['type']=='rounded_rectangular_plate' and f['generatorSupported'] for f in families)
    meta=get_part_family_form_metadata('rounded_rectangular_plate')
    assert [f['name'] for f in meta['fields'][:4]] == ['length','width','thickness','cornerRadius']
    assert meta['fields'][0]['unit'] == 'mm'
    assert get_part_family_form_metadata('spacer_block')['partType'] == 'spacer_block'
    import pytest
    with pytest.raises(ValueError): get_part_family_form_metadata('missing')
    r=subprocess.run([sys.executable,'-m','printspec.cli','form-metadata','rounded_rectangular_plate'],cwd=root,text=True,capture_output=True,env={**os.environ,'PYTHONPATH':'packages/python'})
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)['partType'] == 'rounded_rectangular_plate'
    r=subprocess.run([sys.executable,'-m','printspec.cli','list-part-families'],cwd=root,text=True,capture_output=True,env={**os.environ,'PYTHONPATH':'packages/python'})
    assert r.returncode == 0, r.stderr
    assert any(f['type']=='spacer_block' for f in json.loads(r.stdout))

def test_python_bundle_helpers_and_zip(tmp_path):
    from printspec import create_bundle, write_bundle_to_directory, write_bundle_to_zip
    b=create_bundle(spec, {'includePartCad': True})
    assert b['supported']
    paths=[f['path'] for f in b['files']]
    assert paths == sorted(paths)
    assert 'printspec.json' in paths and 'cad/model.scad' in paths and 'cad/model.py' in paths
    assert json.loads(next(f['content'] for f in b['files'] if f['path']=='bundle-manifest.json'))['kind']=='part'
    out=tmp_path/'bundle'; write_bundle_to_directory(b,out)
    assert (out/'README.md').exists() and (out/'cad/model.py').exists()
    import pytest, zipfile
    with pytest.raises(ValueError): write_bundle_to_directory({'supported':True,'files':[{'path':'../evil','content':'x','mediaType':'text/plain'}],'warnings':[]}, tmp_path/'bad', overwrite=True)
    z=tmp_path/'bundle.zip'; write_bundle_to_zip(b,z)
    with zipfile.ZipFile(z) as zz: assert 'bundle-manifest.json' in zz.namelist()

def test_python_project_bundle_and_cli(tmp_path):
    b=create_bundle(project, {'includePartCad': True})
    paths=[f['path'] for f in b['files']]
    assert 'bom/bom.md' in paths and 'partcad.yaml' in paths and 'parts/base/printspec.json' in paths
    assert len(b['warnings']) >= 2
    env={**os.environ,'PYTHONPATH':'packages/python'}; out=tmp_path/'cli-bundle'; z=tmp_path/'cli-bundle.zip'
    r=subprocess.run([sys.executable,'-m','printspec.cli','bundle','examples/part-families/rounded-rectangular-plate.basic.json','--output',str(out),'--zip',str(z),'--overwrite'],cwd=root,text=True,capture_output=True,env=env)
    assert r.returncode == 0, r.stderr
    assert (out/'bundle-manifest.json').exists() and z.exists()
    assert 'wrote' in r.stdout
