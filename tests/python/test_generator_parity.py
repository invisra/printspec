import json, subprocess
from pathlib import Path
import pytest
from printspec.generators.openscad import generate_openscad
from printspec.generators.cadquery import generate_cadquery

root = Path(__file__).resolve().parents[2]
ts_cli = root / 'packages/typescript/dist/cli.js'
family_files = sorted(f.name for f in (root / 'examples/part-families').glob('*.json'))

@pytest.mark.skipif(not ts_cli.exists(), reason='TypeScript package not built; run `npm run build` first')
@pytest.mark.parametrize('filename', family_files)
def test_python_and_typescript_generator_support_agree(filename, tmp_path):
    spec = json.loads((root / 'examples/part-families' / filename).read_text())
    part = spec.get('part')
    if not part:
        pytest.skip(f'{filename} has no part')
    part_type = part['type']
    spec_path = tmp_path / filename
    spec_path.write_text(json.dumps(spec))
    py_scad_supported = generate_openscad(spec)['supported']
    py_cq_supported = generate_cadquery(spec)['supported']
    ts_scad = subprocess.run(['node', str(ts_cli), 'to-openscad', str(spec_path)], capture_output=True, text=True, timeout=20)
    ts_cq = subprocess.run(['node', str(ts_cli), 'to-cadquery', str(spec_path)], capture_output=True, text=True, timeout=20)
    assert py_scad_supported == (ts_scad.returncode == 0), (
        f"{part_type}: OpenSCAD generator support differs between Python ({py_scad_supported}) "
        f"and TypeScript (exit={ts_scad.returncode}, stderr={ts_scad.stderr.strip()})"
    )
    assert py_cq_supported == (ts_cq.returncode == 0), (
        f"{part_type}: CadQuery generator support differs between Python ({py_cq_supported}) "
        f"and TypeScript (exit={ts_cq.returncode}, stderr={ts_cq.stderr.strip()})"
    )
