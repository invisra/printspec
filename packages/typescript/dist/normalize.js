export function normalizePrintSpec(spec) { return JSON.parse(JSON.stringify({ ...spec, units: spec.units ?? 'mm' })); }
