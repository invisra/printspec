import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'tools/schema-site/validator');
const outDir = path.join(root, 'public/printspec/validator');
const entry = path.join(srcDir, 'validator.ts');
const outfile = path.join(outDir, 'validator.js');
const forbidden = [/node:fs/, /node:path/, /node:url/, /require\(["']fs["']\)/, /require\(["']path["']\)/, /require\(["']url["']\)/];

mkdirSync(outDir, {recursive: true});
copyFileSync(path.join(srcDir, 'index.html'), path.join(outDir, 'index.html'));
copyFileSync(path.join(srcDir, 'style.css'), path.join(outDir, 'style.css'));

async function tryEsbuild() {
  try {
    const esbuild = await import('esbuild');
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      outfile,
      format: 'esm',
      platform: 'browser',
      target: ['es2020'],
      minify: true,
      alias: {'@invisra/printspec/browser': path.join(root, 'packages/typescript/src/browser.ts')},
    });
    return true;
  } catch (error) {
    console.warn(`esbuild unavailable; using schema-site fallback bundler (${error.message})`);
    return false;
  }
}

async function fallbackBundle() {
  const schemas = JSON.parse(readFileSync(path.join(root, 'packages/typescript/src/generated/schemas.generated.ts'), 'utf8')
    .match(/export const bundledSchemas = (\{[\s\S]*?\n\}) as const;/)?.[1] ?? '{}');
  let sourceTs = readFileSync(entry, 'utf8')
    .replace(/import \{validatePrintSpec, listPartFamilies, getPartFamilyFormMetadata\} from ['"]@invisra\/printspec\/browser['"];\n\n/, '')
    .replace(/export const examples/, 'const examples');
  let source;
  try {
    const ts = await import('typescript');
    source = ts.transpileModule(sourceTs, {compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020}}).outputText;
  } catch (error) {
    throw new Error(`Fallback bundler requires the TypeScript package: ${error.message}`);
  }
  const runtime = `const schemas = ${JSON.stringify(schemas)};\nconst generatorSupported = new Set(['rounded_rectangular_plate','spacer_block','round_spacer','electronics_standoff']);\nfunction partEntries(){return Object.entries(schemas).map(([schemaFilename,schema])=>({schemaFilename,schema,type:schema?.properties?.type?.const})).filter(e=>typeof e.type==='string'&&e.schema?.properties?.parameters).sort((a,b)=>a.type.localeCompare(b.type));}\nfunction listPartFamilies(){return partEntries().map(({type,schemaFilename,schema})=>({type,title:schema.title??type,description:schema.description,schemaFilename,generatorSupported:generatorSupported.has(type)}));}\nfunction getPartFamilyFormMetadata(partType){const e=partEntries().find(x=>x.type===partType);if(!e)throw new Error('Unsupported printspec part family: '+partType);return {partType,title:e.schema.title??partType,description:e.schema.description,fields:Object.keys(e.schema.properties.parameters.properties??{}).map(name=>({name,required:(e.schema.properties.parameters.required??[]).includes(name)})),groups:[]};}\nfunction validatePrintSpec(spec){const errors=[];const add=(p,m)=>errors.push(p? p+' '+m:m);if(!spec||typeof spec!=='object')add('','must be an object');if(spec?.printspecVersion!=='0.1.0')add('printspecVersion','must be 0.1.0');if(spec?.units!=='mm')add('units','must be mm');const part=spec?.part;if(!part||typeof part!=='object')add('part','is required');else{const entry=partEntries().find(e=>e.type===part.type);if(!entry)add('part.type','must be a supported part family');if(typeof part.label!=='string')add('part.label','must be a string');const params=part.parameters??{};for(const req of entry?.schema?.properties?.parameters?.required??[])if(params[req]===undefined)add('part.parameters.'+req,'is required');if(part.type==='rounded_rectangular_plate'&&params.cornerRadius>Math.min(params.length,params.width)/2)add('part.parameters.cornerRadius','exceeds half of min(length,width)');if(part.type==='round_spacer'&&params.innerDiameter!=null&&params.innerDiameter>=params.outerDiameter)add('part.parameters.innerDiameter','must be less than outerDiameter');if(part.type==='electronics_standoff'){if(params.holeDiameter>=params.outerDiameter)add('part.parameters.holeDiameter','must be less than outerDiameter');if((params.baseDiameter==null)!==(params.baseHeight==null))add('part.parameters.baseDiameter','and baseHeight must be provided together');if(params.baseDiameter!=null&&params.baseDiameter<params.outerDiameter)add('part.parameters.baseDiameter','must be greater than or equal to outerDiameter');}}return {valid:errors.length===0,errors};}\n`;
  writeFileSync(outfile, `${runtime}\n${source}\n`);
}

if (!(await tryEsbuild())) await fallbackBundle();
const bundled = readFileSync(outfile, 'utf8');
for (const pattern of forbidden) if (pattern.test(bundled)) throw new Error(`Validator bundle contains forbidden Node built-in pattern: ${pattern}`);
console.log(`Built schema validator at ${path.relative(root, outDir)}`);
