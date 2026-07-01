import json, os, zipfile
from pathlib import Path, PurePosixPath
from .validate import validate_printspec
from .normalize import normalize_printspec
from .generators import generate_openscad, generate_cadquery
from .bom import extract_bom, bom_to_markdown, bom_to_csv, bom_to_supplier_order_list
VERSION='0.1.0'
def _j(x, pretty=True): return json.dumps(x, indent=2 if pretty else None, separators=None if pretty else (',',':'))+'\n'
def _add(files,path,content,mediaType,role): files.append({'path':path,'content':content,'mediaType':mediaType,'role':role})
def _warn(w,msg,path=None): w.append({'path':path,'message':msg} if path else {'message':msg})
def _safe_id(s): return ''.join(c if c.isalnum() or c in '._-' else '-' for c in s)
def _bom(files,base,bom):
    if bom:
        _add(files,base+'bom.md',bom_to_markdown(bom)+'\n','text/markdown','bom-markdown'); _add(files,base+'bom.csv',bom_to_csv(bom)+'\n','text/csv','bom-csv'); _add(files,base+'supplier-order-list.txt',bom_to_supplier_order_list(bom)+'\n','text/plain','supplier-order-list')
def _cad(spec,base,files,w,opts):
    if opts['includeOpenScad']:
        g=generate_openscad(spec); p=base+'cad/model.scad'
        if g.get('supported'):
            _add(files,p,g['code'],'text/plain','openscad-source')
            for m in g.get('warnings') or []: _warn(w,m,p)
        else: _warn(w,g.get('message','OpenSCAD generator unsupported'),p)
    if opts['includeCadQuery']:
        g=generate_cadquery(spec); p=base+'cad/model.py'
        if g.get('supported'):
            _add(files,p,g['code'],'text/x-python','cadquery-source')
            for m in g.get('warnings') or []: _warn(w,m,p)
        else: _warn(w,g.get('message','CadQuery generator unsupported'),p)
def _readme(kind,spec,files,w,bom_count):
    title=spec.get('project',{}).get('label') if kind=='project' else spec.get('part',{}).get('label')
    lines=[f"# {title or 'printspec bundle'}",'']
    if kind=='part': lines.append(f"Part type: {spec.get('part',{}).get('type','unknown')}")
    else:
        if spec.get('project',{}).get('description'): lines += [spec['project']['description'],'']
        lines += ['## Parts']+[f"- {p['id']}: {p.get('label',p['id'])} (quantity {p.get('quantity',1)})" for p in spec.get('project',{}).get('parts',[])]+['']
    lines += [f"printspec version: {spec.get('printspecVersion',VERSION)}",'','## Generated files']+[f"- {f['path']} ({f['role']})" for f in files]+['','## BOM',f"{bom_count} BOM item(s) included." if bom_count else 'No hardware/BOM items were found.','','## Warnings']
    lines += [f"- {x.get('path')+': ' if x.get('path') else ''}{x['message']}" for x in w] if w else ['- None']
    lines += ['','Generated CAD source should be reviewed before manufacturing.']
    return '\n'.join(lines)+'\n'
def _partcad(spec,files):
    cq=sorted([f for f in files if f['role']=='cadquery-source'], key=lambda f:f['path']); pc=spec.get('project',{}).get('partcad',{})
    lines=['package:',f"  name: {pc.get('packageName','printspec-project')}",f"  version: {pc.get('packageVersion',VERSION)}",'  description: Experimental compatibility stub generated from printspec.','','parts:']
    for f in cq:
        parts=f['path'].split('/'); name=parts[1] if len(parts)>2 and parts[0]=='parts' else 'model'; lines += [f"  - name: {name}",'    type: cadquery',f"    path: {f['path']}"]
    if not cq: lines.append('  []')
    return '\n'.join(lines)+'\n'
def _manifest(kind,files,w,spec):
    entries=sorted([{'path':f['path'],'mediaType':f['mediaType'],'role':f['role']} for f in files]+[{'path':'bundle-manifest.json','mediaType':'application/json','role':'bundle-manifest'}], key=lambda x:x['path'])
    return _j({'bundleVersion':VERSION,'createdBy':'printspec','printspecVersion':spec.get('printspecVersion',VERSION),'kind':kind,'files':entries,'warnings':w}, True)
def create_bundle(spec, options=None):
    r=validate_printspec(spec)
    if not r['valid']: return {'supported':False,'files':[],'warnings':[],'message':'Validation failed: '+'; '.join(r['errors'][:3])}
    opts={'includeOpenScad':True,'includeCadQuery':True,'includeBom':True,'includePartCad':False,'prettyJson':True}; opts.update(options or {})
    spec=normalize_printspec(spec); files=[]; w=[]; kind='project' if spec.get('project') else 'part'
    _add(files,'printspec.json',_j(spec,opts['prettyJson']),'application/json','source-spec')
    if kind=='part': _cad(spec,'',files,w,opts); _bom(files,'bom/',extract_bom(spec)) if opts['includeBom'] else None
    else:
        for p in spec['project'].get('parts',[]):
            pid=_safe_id(p['id'])
            if p.get('spec'):
                ps=normalize_printspec(p['spec']); _add(files,f'parts/{pid}/printspec.json',_j(ps,opts['prettyJson']),'application/json','part-source-spec'); _cad(ps,f'parts/{pid}/',files,w,opts)
            elif p.get('specPath'): _warn(w,f"External specPath references are not bundled yet: {p['specPath']}",f'parts/{pid}/printspec.json')
        _bom(files,'bom/',extract_bom(spec)) if opts['includeBom'] else None
        if opts['includePartCad']: _add(files,'partcad.yaml',_partcad(spec,files),'text/yaml','partcad-stub')
    _add(files,'README.md',_readme(kind,spec,files,w,len(extract_bom(spec))),'text/markdown','readme'); _add(files,'bundle-manifest.json',_manifest(kind,files,w,spec),'application/json','bundle-manifest')
    files=sorted(files,key=lambda f:f['path']); return {'supported':True,'files':[{k:f[k] for k in ('path','content','mediaType')} for f in files],'warnings':w,'message':None}
def _assert_safe(p):
    pp=PurePosixPath(p)
    if not p or pp.is_absolute() or '..' in pp.parts: raise ValueError(f'Unsafe bundle path: {p}')
def write_bundle_to_directory(bundle, output_dir, overwrite=False):
    if not bundle.get('supported'): raise ValueError(bundle.get('message') or 'Unsupported bundle')
    out=Path(output_dir)
    if out.exists() and not overwrite: raise FileExistsError(f'Output directory already exists: {out}')
    out.mkdir(parents=True, exist_ok=True)
    root=out.resolve()
    for f in bundle['files']:
        _assert_safe(f['path']); dest=(out/f['path']).resolve()
        if os.path.commonpath([root,dest]) != str(root): raise ValueError(f"Unsafe bundle path: {f['path']}")
        if dest.exists() and not overwrite: raise FileExistsError(f'Output file already exists: {dest}')
        dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(f['content'], encoding='utf8')
def write_bundle_to_zip(bundle, output_path, overwrite=False):
    if not bundle.get('supported'): raise ValueError(bundle.get('message') or 'Unsupported bundle')
    out=Path(output_path)
    if out.exists() and not overwrite: raise FileExistsError(f'Output zip already exists: {out}')
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for f in sorted(bundle['files'], key=lambda x:x['path']): _assert_safe(f['path']); z.writestr(f['path'], f['content'])
