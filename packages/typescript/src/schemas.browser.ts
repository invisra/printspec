import {bundledSchemaFiles, bundledSchemas} from './generated/schemas.generated.js';
import {createAjvFromSchemas} from './schemas.shared.js';

export const schemas: Record<string, any> = bundledSchemas;
export const schemaFiles = [...bundledSchemaFiles];
export function createAjv() { return createAjvFromSchemas(schemas); }
