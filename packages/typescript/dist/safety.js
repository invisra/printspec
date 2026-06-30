const bad = ['weapon', 'firearm', 'ammunition', 'explosive', 'suppressor', 'silencer', 'lockpick', 'bypass', 'implant', 'pressure vessel', 'flight-critical', 'high-voltage'];
export const isPotentiallyUnsafeLabel = (text) => bad.some(w => text.toLowerCase().includes(w));
export const hasDisallowedSupplierRole = isPotentiallyUnsafeLabel;
export function validateSafeMetadata(spec) { const text = JSON.stringify(spec.metadata ?? {}) + ' ' + (spec.part?.label ?? spec.project?.label ?? ''); return { valid: !isPotentiallyUnsafeLabel(text), errors: isPotentiallyUnsafeLabel(text) ? ['Metadata or label may describe a disallowed/safety-critical use.'] : [] }; }
