import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {validatePrintSpec} from '../../packages/typescript/dist/index.js';

const root = path.resolve('../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

test('schema-backed validation resolves nested refs offline', () => {
  const plate = read('examples/part-families/rounded-rectangular-plate.basic.json');
  plate.part.parameters.holes = [{x: 5, y: 5, diameter: 3.2, depth: 'through'}];
  plate.hardware = [{id: 'screw', kind: 'screw', quantity: 4, supplierReferences: [{supplier: 'example', partNumber: 'M3'}]}];
  assert.equal(validatePrintSpec(plate).valid, true);

  const project = {
    printspecVersion: '0.1.0',
    units: 'mm',
    project: {
      type: 'project',
      label: 'Offline nested project',
      parts: [{id: 'plate', label: 'Plate', spec: plate}]
    }
  };
  const result = validatePrintSpec(project);
  assert.equal(result.valid, true, result.errors.join('; '));
});
