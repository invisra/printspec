import type { PrintSpec } from "./types.js";
function normSupplier(s: string) {
  const x = s.toLowerCase().replace(/\s+/g, "");
  return ["mcmaster", "mcmaster-carr"].includes(x)
    ? "mcmaster"
    : s.toLowerCase();
}
function walk(v: any): any {
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) o[k] = walk(val);
    if ("diameter" in o && "x" in o && "y" in o) {
      o.axis ??= "z";
      o.depth ??= "through";
    }
    if (o.supplier) o.supplier = normSupplier(o.supplier);
    return o;
  }
  return v;
}
export function normalizePrintSpec(spec: PrintSpec): PrintSpec {
  const out = walk(JSON.parse(JSON.stringify(spec)));
  out.units ??= "mm";
  return out;
}
