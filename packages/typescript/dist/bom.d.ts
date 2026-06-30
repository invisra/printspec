import type { BomItem, PrintSpec } from './types.js';
export declare function extractBom(spec: PrintSpec): BomItem[];
export declare function bomToMarkdown(bom: BomItem[]): string;
export declare function bomToCsv(bom: BomItem[]): string;
export declare function bomToSupplierOrderList(bom: BomItem[]): string;
