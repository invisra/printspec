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
export type ValidationResult = { valid: boolean; errors: string[] };

// PartFacts: the canonical, kernel-measured output of executing a printspec on
// a real CAD kernel. Independently versioned from the printspec document
// schema (see schemas/partfacts/). This type is a convenience shape for
// consumers; the JSON Schema in schemas/partfacts/<version>/ is authoritative.
export type PartFactsVector3 = { x: number; y: number; z: number };
export type PartFactsNamedVersion = { name: string; version: string };
export type PartFactsProvenance = {
  printspecVersion: string;
  specDigest?: string;
  generator: PartFactsNamedVersion;
  kernel: PartFactsNamedVersion;
  imageDigest?: string;
  generatedAt?: string;
};
export type PartFactsTopology = {
  solidCount: number;
  shellCount: number;
  faceCount: number;
  edgeCount: number;
  vertexCount: number;
  closed: boolean;
  manifold: boolean;
  valid: boolean;
  genus?: number;
  maxShapeTolerance?: number;
  checks?: {
    name: string;
    status: "pass" | "warn" | "fail";
    detail?: string;
  }[];
};
export type PartFactsAABB = {
  min: PartFactsVector3;
  max: PartFactsVector3;
  size?: PartFactsVector3;
};
export type PartFactsInertiaTensor = {
  ixx: number;
  iyy: number;
  izz: number;
  ixy: number;
  ixz: number;
  iyz: number;
  referencePoint?: PartFactsVector3;
};
export type PartFactsMassProperties = {
  volume: number;
  surfaceArea: number;
  centerOfMass: PartFactsVector3;
  boundingBox: PartFactsAABB;
  inertiaTensor?: PartFactsInertiaTensor;
};
export type PartFactsCylindricalFace = {
  id?: string;
  featureId?: string;
  radius: number;
  axis: PartFactsVector3;
  start: PartFactsVector3;
  end: PartFactsVector3;
  length: number;
  convex: boolean;
  through?: boolean;
  blindDepth?: number;
};
export type PartFactsPlanarFace = {
  id?: string;
  normal: PartFactsVector3;
  offset: number;
  area: number;
  centroid?: PartFactsVector3;
};
export type PartFactsHoleSegment = {
  radius: number;
  start: PartFactsVector3;
  end: PartFactsVector3;
  faceIds: string[];
};
export type PartFactsHole = {
  featureId: string;
  axis: PartFactsVector3;
  start: PartFactsVector3;
  end: PartFactsVector3;
  convex: boolean;
  through?: boolean;
  segments: PartFactsHoleSegment[];
};
export type PartFactsFeatureInventory = {
  cylindricalFaces?: PartFactsCylindricalFace[];
  planarFaces?: PartFactsPlanarFace[];
  holes?: PartFactsHole[];
  otherFaceCount?: number;
};
export type PartFactsSolidFacts = {
  id?: string;
  topology: PartFactsTopology;
  massProperties?: PartFactsMassProperties;
};
export type PartFacts = {
  partfactsVersion: string;
  units: { length: "mm"; angle?: "deg" };
  provenance: PartFactsProvenance;
  topology: PartFactsTopology;
  // Required unless topology.valid is false (integrated quantities are
  // undefined for an invalid shape); see the schema's top-level conditional.
  massProperties?: PartFactsMassProperties;
  solids?: PartFactsSolidFacts[];
  featureInventory?: PartFactsFeatureInventory;
  extensions?: Record<string, unknown>;
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
  operation: "add" | "subtract";
  dimensions: Record<string, number>;
};
export type Feature = {
  id: string;
  kind: string;
  target: string;
  parameters?: Record<string, unknown>;
};
export type ComposablePartSpec = {
  type: "composable_part";
  label: string;
  components: Component[];
  features?: Feature[];
  hardware?: HardwareItem[];
};
export type ProjectSpec = {
  type: "project";
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
  units: "mm";
  part?: PartFamilySpec | ComposablePartSpec;
  project?: ProjectSpec;
  hardware?: HardwareItem[];
  metadata?: Record<string, unknown>;
};
export type GeneratorResult = {
  supported: boolean;
  code: string;
  message?: string;
  warnings?: string[];
};
