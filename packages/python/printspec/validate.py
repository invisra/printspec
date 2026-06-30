try:
    import json
    from pathlib import Path
    from jsonschema import Draft202012Validator, RefResolver, FormatChecker
except ModuleNotFoundError:  # fallback keeps source-tree tests usable before optional install
    Draft202012Validator = RefResolver = FormatChecker = None
from .semantic import validate_semantic
TYPES=['rounded_rectangular_plate','spacer_block','round_spacer','electronics_standoff','l_bracket','cable_comb','cable_clip','drill_guide','simple_box','simple_lid']
REQ={'rounded_rectangular_plate':['length','width','thickness','cornerRadius'],'spacer_block':['length','width','height'],'round_spacer':['outerDiameter','height'],'electronics_standoff':['outerDiameter','height','holeDiameter'],'l_bracket':['legLengthA','legLengthB','width','thickness'],'cable_comb':['length','width','thickness','slotCount','slotWidth','slotSpacing','slotDepth'],'cable_clip':['baseLength','baseWidth','baseThickness','clipWallThickness'],'drill_guide':['length','width','height','holeDiameter','holeCount','holeSpacing'],'simple_box':['outerLength','outerWidth','outerHeight','wallThickness'],'simple_lid':['length','width','thickness']}
def _dim(v): return isinstance(v,(int,float)) and not isinstance(v,bool) and v>0 and v<=10000
def _hw(h, errors, p='hardware'):
    if not h.get('id') or not h.get('kind') or not isinstance(h.get('quantity'), int) or h.get('quantity')<1: errors.append(f'{p}: invalid hardware item')
    for r in h.get('supplierReferences') or []:
        if not r.get('supplier') or not r.get('partNumber'): errors.append(f'{p}: invalid supplier reference')
        if r.get('url') and not str(r['url']).startswith(('http://','https://')): errors.append(f'{p}: invalid supplier reference url')
def _fallback(schema, data, semantic=False):
    errors=[]
    if schema=='part-family.schema.json':
        part=data
        if not part or part.get('type') not in TYPES: errors.append('unknown part type')
        if not part.get('label'): errors.append('missing label')
        p=part.get('parameters') or {}; 
        if not p: errors.append('missing parameters')
        for k in REQ.get(part.get('type'),[]):
            if not _dim(p.get(k)): errors.append(f'parameters.{k}: invalid dimension')
        if part.get('type')=='cable_clip' and not (_dim(p.get('clipInnerDiameter')) or _dim(p.get('clipOpeningWidth'))): errors.append('clipInnerDiameter or clipOpeningWidth required')
        for h in p.get('holes') or []:
            if not _dim(h.get('diameter')) or not (h.get('depth')=='through' or _dim(h.get('depth'))): errors.append('invalid hole')
        for h in part.get('hardware') or []: _hw(h, errors, 'part.hardware')
    elif schema=='composable-part.schema.json':
        part=data
        if part.get('type')!='composable_part': errors.append('not composable_part')
        if not part.get('label'): errors.append('missing label')
        if not part.get('components'): errors.append('missing components')
        for h in part.get('hardware') or []: _hw(h, errors, 'part.hardware')
    elif schema=='project.schema.json':
        project=data
        if project.get('type')!='project': errors.append('not project')
        if not project.get('label'): errors.append('missing label')
        if not project.get('parts'): errors.append('missing parts')
        for h in project.get('hardware') or []: _hw(h, errors, 'project.hardware')
    else:
        spec=data
        if spec.get('printspecVersion')!='0.1.0': errors.append('invalid printspecVersion')
        if spec.get('units')!='mm': errors.append('invalid units')
        if bool(spec.get('part'))==bool(spec.get('project')): errors.append('expected exactly one of part or project')
        if spec.get('part'): errors+=_fallback('composable-part.schema.json' if spec['part'].get('type')=='composable_part' else 'part-family.schema.json', spec['part'])['errors']
        if spec.get('project'): errors+=_fallback('project.schema.json', spec['project'])['errors']
        for h in spec.get('hardware') or []: _hw(h, errors, 'top-level.hardware')
    if not errors and semantic: errors.extend(validate_semantic(data))
    return {'valid': not errors, 'errors': errors}
if Draft202012Validator:
    SCHEMA_DIR=Path(__file__).resolve().parents[3]/'schemas'
    def _load(name): return json.loads((SCHEMA_DIR/name).read_text())
    STORE={}
    for p in SCHEMA_DIR.glob('*.schema.json'):
        d=_load(p.name); STORE[p.name]=d
        if d.get('$id'): STORE[d['$id']]=d
    def _validate(schema_name, data, semantic=False):
        v=Draft202012Validator(STORE[schema_name], resolver=RefResolver.from_schema(STORE[schema_name], store=STORE), format_checker=FormatChecker())
        errors=[f"/{'/'.join(map(str,e.path))}: {e.message}" for e in sorted(v.iter_errors(data), key=lambda e:list(e.path))]
        if not errors and semantic: errors.extend(validate_semantic(data))
        return {'valid': not errors, 'errors': errors}
else:
    _validate=_fallback
def validate_part_family_spec(part): return _validate('part-family.schema.json', part)
def validate_composable_part_spec(part): return _validate('composable-part.schema.json', part)
def validate_project_spec(project): return _validate('project.schema.json', project)
def validate_printspec(spec, semantic=True): return _validate('printspec.schema.json', spec, semantic)
