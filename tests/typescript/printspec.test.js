import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {validatePrintSpec,extractBom,bomToMarkdown,bomToCsv,bomToSupplierOrderList,generateOpenScad,generateCadQuery} from '../../packages/typescript/dist/index.js';
const spec=JSON.parse(fs.readFileSync('../../examples/part-families/rounded-rectangular-plate.basic.json','utf8'));
const project=JSON.parse(fs.readFileSync('../../examples/projects/simple-enclosure-project.json','utf8'));
test('validation works',()=>assert.equal(validatePrintSpec(spec).valid,true));
test('bom helpers work',()=>{const bom=extractBom(project); assert.equal(bom[0].quantity,4); assert.match(bomToMarkdown(bom),/lid_screws/); assert.match(bomToCsv(bom),/91292A112/); assert.match(bomToSupplierOrderList(bom),/mcmaster/);});
test('generators work',()=>{assert.match(generateOpenScad(spec).code,/difference/); const cq=generateCadQuery(spec).code; assert.match(cq,/part =/); assert.doesNotMatch(cq,/export/); const bad=structuredClone(spec); bad.part.type='round_spacer'; assert.equal(generateOpenScad(bad).supported,false); assert.match(generateOpenScad(bad).message,/Unsupported/);});
