def _dups(vals, label):
    seen=set(); out=[]
    for v in vals:
        if v in seen: out.append(f"duplicate {label} id: {v}")
        seen.add(v)
    return out

def _part(part, prefix='part'):
    e=[]; p=part.get('parameters') or {}
    if part.get('type')=='rounded_rectangular_plate' and p.get('cornerRadius',0)>min(p.get('length',0),p.get('width',0))/2: e.append(f'{prefix}.parameters.cornerRadius exceeds half of min(length,width)')
    if part.get('type')=='simple_box' and p.get('wallThickness',0)>=min(p.get('outerLength',0),p.get('outerWidth',0))/2: e.append(f'{prefix}.parameters.wallThickness must be less than half of outer dimensions')
    if part.get('type')=='round_spacer' and p.get('innerDiameter') is not None and p.get('innerDiameter')>=p.get('outerDiameter',0): e.append(f'{prefix}.parameters.innerDiameter must be less than outerDiameter')
    if part.get('type')=='electronics_standoff':
        if p.get('holeDiameter',0)>=p.get('outerDiameter',0): e.append(f'{prefix}.parameters.holeDiameter must be less than outerDiameter')
        if (p.get('baseDiameter') is None) != (p.get('baseHeight') is None): e.append(f'{prefix}.parameters.baseDiameter and baseHeight must be provided together')
        if p.get('baseDiameter') is not None and p.get('baseDiameter')<p.get('outerDiameter',0): e.append(f'{prefix}.parameters.baseDiameter must be greater than or equal to outerDiameter')
    maxw=p.get('width') or p.get('outerWidth') or p.get('outerDiameter')
    for h in p.get('holes') or []:
        if maxw and h.get('diameter',0)>maxw: e.append(f'{prefix}.parameters.holes diameter exceeds target width')
    return e

def validate_semantic(spec):
    e=[]
    def hw(items,label):
        e.extend(_dups([h.get('id') for h in items or [] if h.get('id')], f'{label} hardware'))
        for h in items or []:
            if not isinstance(h.get('quantity'), int) or h.get('quantity')<1: e.append(f'{label}.hardware quantity must be integer >= 1')
            for r in h.get('supplierReferences') or []:
                if not r.get('partNumber'): e.append(f'{label}.supplierReference partNumber is required')
                if r.get('url') and not str(r['url']).startswith(('http://','https://')): e.append(f'{label}.supplierReference url is invalid')
    hw(spec.get('hardware'), 'top-level')
    part=spec.get('part')
    if part:
        if part.get('type')=='composable_part':
            ids=[c.get('id') for c in part.get('components') or []]; e.extend(_dups(ids,'component')); known=set(ids)
            e.extend(_dups([f.get('id') for f in part.get('features') or [] if f.get('id')],'feature'))
            for f in part.get('features') or []:
                if f.get('target') and f.get('target') not in known: e.append(f"feature {f.get('id','')} target does not exist: {f.get('target')}")
            for c in part.get('components') or []:
                rel=c.get('relation') or {}; t=rel.get('target')
                if rel.get('type') in ['mirrored_from','attached_to_face','on_top_of'] and t and t not in known: e.append(f"component {c.get('id')} relation target does not exist: {t}")
        else: e.extend(_part(part))
        hw(part.get('hardware'),'part')
    proj=spec.get('project')
    if proj:
        part_ids=[p.get('id') for p in proj.get('parts') or []]; hw_ids=[h.get('id') for h in proj.get('hardware') or []]
        e.extend(_dups(part_ids,'project part')); e.extend(_dups(hw_ids,'project hardware')); ps=set(part_ids); hs=set(hw_ids)
        for r in proj.get('relationships') or []:
            if r.get('partA') and r.get('partA') not in ps: e.append(f"relationship partA missing: {r.get('partA')}")
            if r.get('partB') and r.get('partB') not in ps: e.append(f"relationship partB missing: {r.get('partB')}")
            if r.get('hardware') and r.get('hardware') not in hs: e.append(f"relationship hardware missing: {r.get('hardware')}")
        for p in proj.get('parts') or []:
            if p.get('spec'): e.extend([f"project.parts.{p.get('id')}: {x}" for x in validate_semantic(p['spec'])])
        hw(proj.get('hardware'),'project')
    return e
