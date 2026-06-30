TYPES=['rounded_rectangular_plate','spacer_block','round_spacer','electronics_standoff','l_bracket','cable_comb','cable_clip','drill_guide','simple_box','simple_lid']
REQ={'rounded_rectangular_plate':['length','width','thickness','cornerRadius'],'spacer_block':['length','width','height'],'round_spacer':['outerDiameter','height'],'electronics_standoff':['outerDiameter','height','holeDiameter'],'l_bracket':['legLengthA','legLengthB','width','thickness'],'cable_comb':['length','width','thickness','slotCount','slotWidth','slotSpacing','slotDepth'],'cable_clip':['baseLength','baseWidth','baseThickness','clipWallThickness'],'drill_guide':['length','width','height','holeDiameter','holeCount','holeSpacing'],'simple_box':['outerLength','outerWidth','outerHeight','wallThickness'],'simple_lid':['length','width','thickness']}
def _dim(v): return isinstance(v,(int,float)) and not isinstance(v,bool) and v>0 and v<=10000
def _hw(h, errors):
    if not h.get('id') or not h.get('kind') or not isinstance(h.get('quantity'), int) or h.get('quantity')<1: errors.append('invalid hardware item')
    for r in h.get('supplierReferences') or []:
        if not r.get('supplier') or not r.get('partNumber'): errors.append('invalid supplier reference')
        if r.get('url') and not (str(r['url']).startswith('http://') or str(r['url']).startswith('https://')): errors.append('invalid supplier reference url')
def validate_part_family_spec(part):
    errors=[]
    if not part or part.get('type') not in TYPES: errors.append('unknown part type')
    if not part.get('label'): errors.append('missing label')
    p=part.get('parameters') or {}
    if not p: errors.append('missing parameters')
    for k in REQ.get(part.get('type'),[]):
        if not _dim(p.get(k)): errors.append(f'invalid dimension {k}')
    if part.get('type')=='cable_clip' and not (_dim(p.get('clipInnerDiameter')) or _dim(p.get('clipOpeningWidth'))): errors.append('clipInnerDiameter or clipOpeningWidth required')
    for h in p.get('holes') or []:
        if not _dim(h.get('diameter')) or not (h.get('depth')=='through' or _dim(h.get('depth'))): errors.append('invalid hole')
    for h in part.get('hardware') or []: _hw(h, errors)
    return {'valid':not errors,'errors':errors}
def validate_composable_part_spec(part):
    errors=[]
    if part.get('type')!='composable_part': errors.append('not composable_part')
    if not part.get('label'): errors.append('missing label')
    if not part.get('components'): errors.append('missing components')
    for h in part.get('hardware') or []: _hw(h, errors)
    return {'valid':not errors,'errors':errors}
def validate_project_spec(project):
    errors=[]
    if project.get('type')!='project': errors.append('not project')
    if not project.get('label'): errors.append('missing label')
    if not project.get('parts'): errors.append('missing parts')
    for h in project.get('hardware') or []: _hw(h, errors)
    return {'valid':not errors,'errors':errors}
def validate_printspec(spec):
    errors=[]
    if spec.get('printspecVersion')!='0.1.0': errors.append('invalid printspecVersion')
    if spec.get('units')!='mm': errors.append('invalid units')
    if bool(spec.get('part'))==bool(spec.get('project')): errors.append('expected exactly one of part or project')
    if spec.get('part'):
        r=validate_composable_part_spec(spec['part']) if spec['part'].get('type')=='composable_part' else validate_part_family_spec(spec['part']); errors+=r['errors']
    if spec.get('project'): errors+=validate_project_spec(spec['project'])['errors']
    for h in spec.get('hardware') or []: _hw(h, errors)
    return {'valid':not errors,'errors':errors}
