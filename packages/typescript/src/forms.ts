import {schemas} from './schemas.js';

export type FormGroup = {id: string; title: string; fields: string[]};
export type FormField = {
  name: string; title: string; description?: string; required: boolean; type: string;
  control?: string; unit?: string; step?: number; minimum?: number; exclusiveMinimum?: number;
  maximum?: number; default?: unknown; examples?: unknown[]; priority?: 'primary' | 'advanced';
};
export type FormMetadata = {partType: string; title: string; description?: string; fields: FormField[]; groups: FormGroup[]};
export type PartFamilySummary = {type: string; title: string; description?: string; schemaFilename: string; generatorSupported?: boolean};

const generatorSupported = new Set(['rounded_rectangular_plate','spacer_block','round_spacer','electronics_standoff','cable_comb','cable_clip','wall_mount_bracket','l_bracket','drawer_divider','project_enclosure_tray']);

function partFamilyEntries(): Array<{type: string; filename: string; schema: any}> {
  return Object.entries(schemas)
    .map(([filename, schema]) => ({filename, schema, type: schema?.properties?.type?.const}))
    .filter((entry): entry is {type: string; filename: string; schema: any} => typeof entry.type === 'string' && !!entry.schema?.properties?.parameters)
    .sort((a, b) => a.type.localeCompare(b.type));
}

function schemaType(field: any): string {
  if (typeof field?.type === 'string') return field.type;
  if (field?.$ref) return 'object';
  if (Array.isArray(field?.type)) return field.type.join('|');
  return 'unknown';
}

export function listPartFamilies(): PartFamilySummary[] {
  return partFamilyEntries().map(({type, filename, schema}) => ({
    type,
    title: schema.title ?? type,
    description: schema.description,
    schemaFilename: filename,
    generatorSupported: generatorSupported.has(type),
  }));
}

export function getPartFamilyFormMetadata(partType: string): FormMetadata {
  const entry = partFamilyEntries().find((candidate) => candidate.type === partType);
  if (!entry) throw new Error(`Unsupported printspec part family: ${partType}`);
  const parameters = entry.schema?.properties?.parameters;
  const properties = parameters?.properties ?? {};
  const required = new Set<string>(parameters?.required ?? []);
  const metadata = parameters?.['x-printspec-ui'] ?? {};
  const known = new Set(Object.keys(properties));
  const ordered = Array.isArray(metadata.order) ? metadata.order.filter((name: string) => known.has(name)) : Object.keys(properties).sort();
  for (const name of Object.keys(properties).sort()) if (!ordered.includes(name)) ordered.push(name);
  const groups: FormGroup[] = Array.isArray(metadata.groups) && metadata.groups.length
    ? metadata.groups.map((group: any) => ({id: String(group.id), title: String(group.title ?? group.id), fields: (group.fields ?? []).filter((name: string) => known.has(name))}))
    : [{id: 'parameters', title: parameters?.title ?? 'Parameters', fields: ordered}];
  return {
    partType,
    title: entry.schema.title ?? partType,
    description: entry.schema.description,
    fields: ordered.map((name: string) => {
      const field = properties[name] ?? {};
      return {
        name,
        title: field.title ?? name,
        description: field.description,
        required: required.has(name),
        type: schemaType(field),
        control: field['x-printspec-control'],
        unit: field['x-printspec-unit'],
        step: field['x-printspec-step'],
        minimum: field.minimum,
        exclusiveMinimum: field.exclusiveMinimum,
        maximum: field.maximum,
        default: field.default,
        examples: field.examples,
        priority: field['x-printspec-priority'],
      };
    }),
    groups,
  };
}
