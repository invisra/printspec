export function extractBom(spec) { const out = []; if (spec.hardware)
    out.push(...spec.hardware); if (spec.part?.hardware)
    out.push(...spec.part.hardware); if (spec.project?.hardware)
    out.push(...spec.project.hardware); return out.map(i => ({ ...i, quantity: Math.max(1, Math.trunc(i.quantity || 1)) })); }
export function bomToMarkdown(bom) { return ['| ID | Kind | Size | Qty | Supplier | Part Number |', '| --- | --- | --- | ---: | --- | --- |', ...bom.map(i => `| ${i.id} | ${i.kind} | ${i.size ?? ''} | ${i.quantity} | ${i.supplierReferences?.[0]?.supplier ?? ''} | ${i.supplierReferences?.[0]?.partNumber ?? ''} |`)].join('\n'); }
export function bomToCsv(bom) { return ['id,kind,standard,size,quantity,role,supplier,partNumber,url', ...bom.map(i => [i.id, i.kind, i.standard ?? '', i.size ?? '', i.quantity, i.role ?? '', i.supplierReferences?.[0]?.supplier ?? '', i.supplierReferences?.[0]?.partNumber ?? '', i.supplierReferences?.[0]?.url ?? ''].map(v => `"${String(v).replaceAll('"', '""')}"`).join(','))].join('\n'); }
export function bomToSupplierOrderList(bom) { return bom.flatMap(i => (i.supplierReferences ?? []).map(r => `${r.supplier}: ${r.partNumber} x ${i.quantity}${r.url ? ` (${r.url})` : ''}`)).join('\n'); }
