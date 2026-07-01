declare module 'node:fs' { const fs: any; export default fs; }
declare module 'node:path' { const path: any; export default path; export function basename(p:string):string; export function dirname(p:string):string; export function join(...p:string[]):string; export function resolve(...p:string[]):string; }
declare module 'node:url' { export function fileURLToPath(url: string | URL): string; }
declare module 'ajv' { export default class Ajv { constructor(opts?: any); addSchema(schema:any,key?:string):void; getSchema(key:string):any; compile(schema:any):any; } }
declare module 'ajv/dist/2020' { export default class Ajv2020 { constructor(opts?: any); addSchema(schema:any,key?:string):Ajv2020; getSchema(key:string):any; compile(schema:any):any; } }
declare module 'ajv-formats' { export default function addFormats(ajv:any):void; }
