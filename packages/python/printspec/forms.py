from __future__ import annotations
from .validate import SCHEMAS

_GENERATOR_SUPPORTED = {'rounded_rectangular_plate','spacer_block','round_spacer','electronics_standoff'}

def _part_family_entries():
    entries=[]
    for filename, schema in SCHEMAS.items():
        part_type = schema.get('properties', {}).get('type', {}).get('const')
        if isinstance(part_type, str) and schema.get('properties', {}).get('parameters'): entries.append((part_type, filename, schema))
    return sorted(entries, key=lambda item: item[0])

def _schema_type(field):
    if isinstance(field.get('type'), str): return field['type']
    if '$ref' in field: return 'object'
    if isinstance(field.get('type'), list): return '|'.join(field['type'])
    return 'unknown'

def list_part_families() -> list[dict]:
    return [{'type': t, 'title': s.get('title', t), 'description': s.get('description'), 'schemaFilename': f, 'generatorSupported': t in _GENERATOR_SUPPORTED} for t, f, s in _part_family_entries()]

def get_part_family_form_metadata(part_type: str) -> dict:
    entry = next(((t, f, s) for t, f, s in _part_family_entries() if t == part_type), None)
    if entry is None: raise ValueError(f'Unsupported printspec part family: {part_type}')
    _, _, schema = entry
    parameters = schema.get('properties', {}).get('parameters', {})
    properties = parameters.get('properties', {})
    required = set(parameters.get('required', []))
    ui = parameters.get('x-printspec-ui', {})
    known = set(properties)
    if isinstance(ui.get('order'), list): ordered = [n for n in ui['order'] if n in known]
    else: ordered = sorted(properties)
    for name in sorted(properties):
        if name not in ordered: ordered.append(name)
    if isinstance(ui.get('groups'), list) and ui['groups']:
        groups = [{'id': str(g.get('id')), 'title': str(g.get('title', g.get('id'))), 'fields': [n for n in g.get('fields', []) if n in known]} for g in ui['groups']]
    else:
        groups = [{'id': 'parameters', 'title': parameters.get('title', 'Parameters'), 'fields': ordered}]
    fields=[]
    for name in ordered:
        field=properties.get(name, {})
        item={'name': name, 'title': field.get('title', name), 'description': field.get('description'), 'required': name in required, 'type': _schema_type(field)}
        for out,key in [('control','x-printspec-control'),('unit','x-printspec-unit'),('step','x-printspec-step'),('minimum','minimum'),('exclusiveMinimum','exclusiveMinimum'),('maximum','maximum'),('default','default'),('examples','examples'),('priority','x-printspec-priority')]:
            if key in field: item[out]=field[key]
        fields.append(item)
    return {'partType': part_type, 'title': schema.get('title', part_type), 'description': schema.get('description'), 'fields': fields, 'groups': groups}
