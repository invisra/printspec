export declare const isPotentiallyUnsafeLabel: (text: string) => boolean;
export declare const hasDisallowedSupplierRole: (text: string) => boolean;
export declare function validateSafeMetadata(spec: any): {
    valid: boolean;
    errors: string[];
};
