#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePrintSpec,generateOpenScad,generateCadQuery,extractBom,bomToMarkdown,bomToCsv,bomToSupplierOrderList} from './index.js';

function fail(msg:string){console.error(msg); return 1;}
function packageVersion(){
 const here=path.dirname(fileURLToPath(import.meta.url));
 for(const candidate of [path.join(here,'..','package.json'),path.join(here,'..','..','package.json'),path.join(here,'..','..','..','package.json')]){
  if(fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate,'utf8')).version as string;
 }
 return '0.1.0';
}
function usage(){return 'usage: printspec <validate|to-openscad|to-cadquery|bom|version> <file> [--output file]\ncommands: validate, to-openscad, to-cadquery, bom, version';}
function load(file:string){
 try{return JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(e:any){
  if(e?.code && e.code !== 'SyntaxError') throw new Error(`${file}: read error: ${e.message}`);
  if(e instanceof SyntaxError) throw new Error(`${file}: parse error: ${e.message}`);
  throw new Error(`${file}: parse error: ${e.message}`);
 }
}
function opt(args:string[], name:string){const i=args.indexOf(name); return i>=0?args[i+1]:undefined;}
function write(text:string,out?:string){if(out) fs.writeFileSync(out,text); else console.log(text);}
function main(argv=process.argv.slice(2)){
 const [cmd,file,...rest]=argv;
 if(cmd==='--version'||cmd==='version'){console.log(`printspec ${packageVersion()}`); return 0;}
 if(cmd==='--help'||cmd==='-h') {console.log(usage()); return 0;}
 if(!cmd) return fail(usage());
 if(!['validate','to-openscad','to-cadquery','bom'].includes(cmd)) return fail(`error: unknown command ${cmd}`);
 if(!file) return fail(usage());
 let spec:any; try{spec=load(file);}catch(e:any){return fail(`error: unable to read JSON: ${e.message}`)}
 if(cmd==='validate'){const r=validatePrintSpec(spec); if(r.valid){console.log('valid'); return 0;} console.error('invalid'); for(const e of r.errors) console.error(`- ${e}`); return 1;}
 if(cmd==='to-openscad'||cmd==='to-cadquery'){const r=validatePrintSpec(spec); if(!r.valid) return fail(`error: ${r.errors.slice(0,3).join('; ')}`); const g=cmd==='to-openscad'?generateOpenScad(spec):generateCadQuery(spec); if(!g.supported) return fail(`error: ${g.message??'unsupported'}`); for(const w of g.warnings??[]) console.error(`warning: ${w}`); write(g.code,opt(rest,'--output')); return 0;}
 if(cmd==='bom'){const fmt=opt(rest,'--format')??'markdown'; const bom=extractBom(spec); const fn:any={markdown:bomToMarkdown,csv:bomToCsv,'supplier-list':bomToSupplierOrderList}[fmt]; if(!fn) return fail('error: unsupported BOM format'); write(fn(bom),opt(rest,'--output')); return 0;}
 return fail(`error: unknown command ${cmd}`);
}
process.exitCode=main();
