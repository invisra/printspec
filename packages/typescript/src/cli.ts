#!/usr/bin/env node
import fs from 'node:fs';
import {validatePrintSpec,generateOpenScad,generateCadQuery,extractBom,bomToMarkdown,bomToCsv,bomToSupplierOrderList} from './index.js';
function fail(msg:string){console.error(msg); return 1;}
function load(file:string){return JSON.parse(fs.readFileSync(file,'utf8'));}
function opt(args:string[], name:string){const i=args.indexOf(name); return i>=0?args[i+1]:undefined;}
function write(text:string,out?:string){if(out) fs.writeFileSync(out,text); else console.log(text);}
function main(argv=process.argv.slice(2)){const [cmd,file,...rest]=argv; if(!cmd||!file) return fail('usage: printspec <validate|to-openscad|to-cadquery|bom> <file> [--output file]'); let spec:any; try{spec=load(file);}catch(e:any){return fail(`error: unable to read JSON: ${e.message}`)}
 if(cmd==='validate'){const r=validatePrintSpec(spec); if(r.valid){console.log('valid'); return 0;} console.error('invalid'); for(const e of r.errors) console.error(`- ${e}`); return 1;}
 if(cmd==='to-openscad'||cmd==='to-cadquery'){const r=validatePrintSpec(spec); if(!r.valid) return fail(`error: ${r.errors.slice(0,3).join('; ')}`); const g=cmd==='to-openscad'?generateOpenScad(spec):generateCadQuery(spec); if(!g.supported) return fail(`error: ${g.message??'unsupported'}`); for(const w of g.warnings??[]) console.error(`warning: ${w}`); write(g.code,opt(rest,'--output')); return 0;}
 if(cmd==='bom'){const fmt=opt(rest,'--format')??'markdown'; const bom=extractBom(spec); const fn:any={markdown:bomToMarkdown,csv:bomToCsv,'supplier-list':bomToSupplierOrderList}[fmt]; if(!fn) return fail('error: unsupported BOM format'); write(fn(bom),opt(rest,'--output')); return 0;}
 return fail(`error: unknown command ${cmd}`);
}
process.exitCode=main();
