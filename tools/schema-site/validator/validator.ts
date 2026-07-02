import {validatePrintSpec, listPartFamilies, getPartFamilyFormMetadata} from '@invisra/printspec/browser';

type Example = {label: string; spec: unknown};

export const examples: Record<string, Example> = {
  round_spacer: {label: 'Round spacer', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'round_spacer', label: 'Round spacer', parameters: {outerDiameter: 12, innerDiameter: 4, height: 8}}}},
  spacer_block: {label: 'Spacer block', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'spacer_block', label: 'Spacer block', parameters: {length: 40, width: 20, height: 8, holes: [{x: -10, y: 0, diameter: 3, depth: 'through'}]}}}},
  electronics_standoff: {label: 'Electronics standoff', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'electronics_standoff', label: 'Electronics standoff', parameters: {outerDiameter: 8, height: 10, holeDiameter: 3, baseDiameter: 12, baseHeight: 2}}}},
  rounded_rectangular_plate: {label: 'Rounded rectangular plate', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'rounded_rectangular_plate', label: 'Rounded rectangular plate', parameters: {length: 80, width: 40, thickness: 3, cornerRadius: 4, holes: [{x: 20, y: 10, diameter: 3, depth: 'through'}]}}}},
  cable_comb: {label: 'Cable comb', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'cable_comb', label: 'Cable comb', parameters: {length: 70, width: 18, thickness: 4, slotCount: 5, slotWidth: 5, slotSpacing: 12, slotDepth: 12}}}},
  cable_clip: {label: 'Cable clip', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'cable_clip', label: 'Cable clip', parameters: {baseLength: 30, baseWidth: 14, baseThickness: 3, clipInnerDiameter: 8, clipWallThickness: 2}}}},
  wall_mount_bracket: {label: 'Wall mount bracket', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'wall_mount_bracket', label: 'Wall mount bracket', parameters: {width: 40, height: 60, thickness: 4, tabDepth: 20, screwHoleDiameter: 4, screwHoleSpacing: 36, cornerRadius: 3}}}},
  l_bracket: {label: 'L bracket', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'l_bracket', label: 'L bracket', parameters: {legLengthA: 40, legLengthB: 30, width: 20, thickness: 4}}}},
  drawer_divider: {label: 'Drawer divider', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'drawer_divider', label: 'Drawer divider', parameters: {length: 120, height: 40, thickness: 3, notchCount: 2, notchWidth: 3, notchDepth: 10, endTab: false}}}},
  project_enclosure_tray: {label: 'Project enclosure tray', spec: {printspecVersion: '0.1.0', units: 'mm', part: {type: 'project_enclosure_tray', label: 'Project enclosure tray', parameters: {outerWidth: 80, outerDepth: 50, wallHeight: 15, wallThickness: 3, floorThickness: 3, cornerRadius: 4, mountHoleDiameter: 3, mountHoleInset: 8}}}},
};

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const input = $<HTMLTextAreaElement>('jsonInput');
const exampleSelect = $<HTMLSelectElement>('exampleSelect');
const resultPanel = $<HTMLElement>('resultPanel');
const resultContent = $<HTMLElement>('resultContent');
const errorList = $<HTMLUListElement>('errorList');

function pretty(value: unknown): string { return JSON.stringify(value, null, 2); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function renderMessages(messages: string[], kind: 'error' | 'warning' = 'error') {
  errorList.innerHTML = '';
  for (const message of messages) {
    const item = document.createElement('li');
    item.className = kind;
    item.textContent = message;
    errorList.append(item);
  }
}
function setResult(kind: 'neutral' | 'success' | 'error', html: string) {
  resultPanel.className = `panel result ${kind}`;
  resultContent.innerHTML = html;
}
function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function validateCurrent() {
  let parsed: unknown;
  try { parsed = JSON.parse(input.value); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setResult('error', `<p class="status">Invalid JSON</p><p>${escapeHtml(message)}</p>`);
    renderMessages([`JSON parse error: ${message}`]);
    return;
  }

  const result = validatePrintSpec(parsed);
  const spec = asRecord(parsed);
  const part = asRecord(spec.part);
  if (result.valid) {
    const families = listPartFamilies();
    const family = typeof part.type === 'string' ? families.find((candidate) => candidate.type === part.type) : undefined;
    const metadata = typeof part.type === 'string' ? getPartFamilyFormMetadata(part.type) : undefined;
    const warnings = [
      ...((family && !family.generatorSupported) ? [`${part.type} is valid but not marked generator-supported.`] : []),
      ...(!metadata ? ['No form metadata was found for this part type.'] : []),
    ];
    setResult('success', `<p class="status">Valid PrintSpec JSON</p><dl><dt>Part type</dt><dd>${escapeHtml(part.type)}</dd><dt>Label</dt><dd>${escapeHtml(part.label)}</dd><dt>Units</dt><dd>${escapeHtml(spec.units)}</dd></dl>`);
    renderMessages(warnings.length ? warnings : ['No warnings.'], warnings.length ? 'warning' : 'warning');
  } else {
    setResult('error', `<p class="status">Invalid PrintSpec JSON</p><p>${result.errors.length} validation issue(s) found.</p>`);
    renderMessages(result.errors.length ? result.errors : ['Validation failed.']);
  }
}

for (const [key, example] of Object.entries(examples)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = example.label;
  exampleSelect.append(option);
}
exampleSelect.addEventListener('change', () => {
  const example = examples[exampleSelect.value];
  if (example) input.value = pretty(example.spec);
});
$('validateButton').addEventListener('click', validateCurrent);
$('clearButton').addEventListener('click', () => { input.value = ''; exampleSelect.value = ''; setResult('neutral', 'Load an example or paste JSON, then click Validate.'); renderMessages([]); });
input.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') validateCurrent(); });
input.value = pretty(examples.round_spacer.spec);
