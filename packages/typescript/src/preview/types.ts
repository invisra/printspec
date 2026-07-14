export type PreviewUnit = "mm";
export type PreviewMaterialRole = "body" | "hole" | "reference" | "warning";
export type PreviewVector3 = { x: number; y: number; z: number };
export type PreviewRotationDeg = Partial<PreviewVector3>;

type PreviewObjectBase = {
  id: string;
  kind: string;
  positionMm: PreviewVector3;
  rotationDeg?: PreviewRotationDeg;
  material: PreviewMaterialRole;
};

export type PreviewBox = PreviewObjectBase & {
  kind: "box";
  dimensionsMm: PreviewVector3;
};

export type PreviewRoundedBox = PreviewObjectBase & {
  kind: "roundedBox";
  dimensionsMm: PreviewVector3;
  radiusMm: number;
};

export type PreviewCylinder = PreviewObjectBase & {
  kind: "cylinder";
  radiusMm: number;
  depthMm: number;
  axis?: "x" | "y" | "z";
};

export type PreviewHoleMarker = PreviewObjectBase & {
  kind: "hole_marker";
  radiusMm: number;
  depthMm: number;
  axis?: "x" | "y" | "z";
};

export type PreviewSlotMarker = PreviewObjectBase & {
  kind: "slot_marker";
  dimensionsMm: PreviewVector3;
};

export type PreviewAxisMarker = PreviewObjectBase & {
  kind: "axis_marker";
  axis: "x" | "y" | "z";
  lengthMm: number;
};

export type PreviewObject =
  | PreviewBox
  | PreviewCylinder
  | PreviewRoundedBox
  | PreviewHoleMarker
  | PreviewSlotMarker
  | PreviewAxisMarker;

export type PreviewScene = {
  units: PreviewUnit;
  partType: string;
  label: string;
  boundsMm?: PreviewVector3;
  objects: PreviewObject[];
  warnings: string[];
};

export type PreviewGenerationResult =
  | { supported: true; scene: PreviewScene; warnings: string[] }
  | { supported: false; message: string; warnings: string[]; errors?: string[] };
