export type SupplierReference = {
    supplier: string;
    partNumber: string;
    url?: string;
    description?: string;
};
export type HardwareItem = {
    id: string;
    kind: string;
    standard?: string;
    size?: string;
    quantity: number;
    role?: string;
    supplierReferences?: SupplierReference[];
};
export type BomItem = HardwareItem;
export type ValidationResult = {
    valid: boolean;
    errors: string[];
};
export type PartFamilySpec = {
    type: string;
    label: string;
    parameters: Record<string, unknown>;
    hardware?: HardwareItem[];
};
export type Component = {
    id: string;
    kind: string;
    operation: 'add' | 'subtract';
    dimensions: Record<string, number>;
};
export type Feature = {
    id: string;
    kind: string;
    target: string;
    parameters?: Record<string, unknown>;
};
export type ComposablePartSpec = {
    type: 'composable_part';
    label: string;
    components: Component[];
    features?: Feature[];
    hardware?: HardwareItem[];
};
export type ProjectSpec = {
    type: 'project';
    label: string;
    parts: {
        id: string;
        label: string;
        spec?: PrintSpec;
        specPath?: string;
        quantity?: number;
    }[];
    hardware?: HardwareItem[];
};
export type PrintSpec = {
    printspecVersion: string;
    units: 'mm';
    part?: PartFamilySpec | ComposablePartSpec;
    project?: ProjectSpec;
    hardware?: HardwareItem[];
    metadata?: Record<string, unknown>;
};
export type GeneratorResult = {
    supported: boolean;
    code: string;
    message?: string;
};
