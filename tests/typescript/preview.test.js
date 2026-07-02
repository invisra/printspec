import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const specs = {
  round_spacer: {printspecVersion:'0.1.0', units:'mm', part:{type:'round_spacer', label:'Round spacer', parameters:{outerDiameter:12, innerDiameter:4, height:8}}},
  spacer_block: {printspecVersion:'0.1.0', units:'mm', part:{type:'spacer_block', label:'Spacer block', parameters:{length:40, width:20, height:8, holes:[{x:-10,y:0,diameter:3,depth:'through'}]}}},
  electronics_standoff: {printspecVersion:'0.1.0', units:'mm', part:{type:'electronics_standoff', label:'Standoff', parameters:{outerDiameter:8, height:10, holeDiameter:3, baseDiameter:12, baseHeight:2}}},
  rounded_rectangular_plate: {printspecVersion:'0.1.0', units:'mm', part:{type:'rounded_rectangular_plate', label:'Plate', parameters:{length:80, width:40, thickness:3, cornerRadius:4, holes:[{x:20,y:10,diameter:3,depth:'through'}]}}},
};

test('preview scene generator supports initial alpha families', async () => {
  const {generatePreviewScene} = await import('../../packages/typescript/dist/preview/index.js');
  for (const [partType, spec] of Object.entries(specs)) {
    const preview = generatePreviewScene(spec);
    assert.equal(preview.supported, true, partType);
    assert.equal(preview.scene.partType, partType);
    assert.ok(preview.scene.objects.some((object) => object.id === 'body' || object.id === 'base'), partType);
    assert.ok(preview.scene.objects.some((object) => object.kind === 'hole_marker'), partType);
    assert.ok(preview.scene.warnings.some((warning) => warning.includes('approximate')), partType);
  }
});

test('invalid specs fail cleanly', async () => {
  const {generatePreviewScene} = await import('../../packages/typescript/dist/preview/index.js');
  const preview = generatePreviewScene({printspecVersion:'0.1.0', units:'mm', part:{type:'round_spacer', label:'Bad', parameters:{outerDiameter:4, innerDiameter:8, height:2}}});
  assert.equal(preview.supported, false);
  assert.match(preview.message, /Invalid printspec/);
  assert.ok(preview.errors.length > 0);
});

test('preview and three dist files avoid Node built-in imports', () => {
  for (const rel of ['packages/typescript/dist/preview/index.js', 'packages/typescript/dist/preview/generate.js', 'packages/typescript/dist/preview/families.js', 'packages/typescript/dist/three.js']) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(source, /from ['"](?:node:)?(?:fs|path|url)['"]/);
    assert.doesNotMatch(source, /import\(['"](?:node:)?(?:fs|path|url)['"]\)/);
  }
});

test('preview import is browser safe and browser entrypoint does not import three adapter', async () => {
  const preview = await import('../../packages/typescript/dist/preview/index.js');
  assert.equal(typeof preview.generatePreviewScene, 'function');
  const browserSource = fs.readFileSync(path.join(root, 'packages/typescript/dist/browser.js'), 'utf8');
  assert.doesNotMatch(browserSource, /three/);
  assert.doesNotMatch(browserSource, /preview/);
});

test('three adapter works with consumer-provided Three-like namespace', async () => {
  const {generatePreviewScene} = await import('../../packages/typescript/dist/preview/index.js');
  const {createThreePreviewObject} = await import('../../packages/typescript/dist/three.js');
  class Group { constructor(){ this.children=[]; this.name=''; } add(child){ this.children.push(child); } }
  class Geometry { constructor(...args){ this.args=args; } }
  class Material { constructor(params){ this.params=params; } }
  class Mesh { constructor(geometry, material){ this.geometry=geometry; this.material=material; this.name=''; this.position={set:(x,y,z)=>{this.position.x=x; this.position.y=y; this.position.z=z;}}; this.rotation={x:0,y:0,z:0}; } }
  const THREE = {Group, BoxGeometry:Geometry, CylinderGeometry:Geometry, MeshBasicMaterial:Material, Mesh};
  const preview = generatePreviewScene(specs.round_spacer);
  const group = createThreePreviewObject(preview.scene, THREE);
  assert.equal(group.children.length, preview.scene.objects.length);
});
