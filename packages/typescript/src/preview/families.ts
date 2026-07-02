import type {PartFamilySpec} from '../types.js';
import type {PreviewHoleMarker, PreviewScene} from './types.js';

type Params = Record<string, any>;
const visualWarning = 'Preview geometry is approximate and for visual UI use only; use OpenSCAD/CadQuery/worker exports for authoritative manufacturing output.';

function holeMarkers(holes: any[] | undefined, fallbackDepth: number): PreviewHoleMarker[] {
  return (holes ?? []).map((h, i) => ({
    id: h.id ?? `hole-${i + 1}`,
    kind: 'hole_marker',
    positionMm: {x: Number(h.x ?? 0), y: Number(h.y ?? 0), z: fallbackDepth / 2},
    radiusMm: Number(h.diameter) / 2,
    depthMm: h.depth === 'through' ? fallbackDepth : Number(h.depth ?? fallbackDepth),
    axis: h.axis ?? 'z',
    material: 'hole',
  }));
}

function scene(part: PartFamilySpec, boundsMm: {x: number; y: number; z: number}, objects: PreviewScene['objects'], warnings: string[] = []): PreviewScene {
  return {units: 'mm', partType: part.type, label: part.label, boundsMm, objects, warnings: [visualWarning, ...warnings]};
}

export function buildRoundSpacerPreview(part: PartFamilySpec): PreviewScene {
  const p = part.parameters as Params;
  const radius = Number(p.outerDiameter) / 2;
  const height = Number(p.height);
  const objects: PreviewScene['objects'] = [{id: 'body', kind: 'cylinder', positionMm: {x: 0, y: 0, z: height / 2}, radiusMm: radius, depthMm: height, axis: 'z', material: 'body'}];
  if (p.innerDiameter != null) objects.push({id: 'center-hole', kind: 'hole_marker', positionMm: {x: 0, y: 0, z: height / 2}, radiusMm: Number(p.innerDiameter) / 2, depthMm: height, axis: 'z', material: 'hole'});
  objects.push(...holeMarkers(p.holes, height));
  return scene(part, {x: radius * 2, y: radius * 2, z: height}, objects);
}

export function buildSpacerBlockPreview(part: PartFamilySpec): PreviewScene {
  const p = part.parameters as Params; const length = Number(p.length), width = Number(p.width), height = Number(p.height);
  return scene(part, {x: length, y: width, z: height}, [{id: 'body', kind: 'box', positionMm: {x: 0, y: 0, z: height / 2}, dimensionsMm: {x: length, y: width, z: height}, material: 'body'}, ...holeMarkers(p.holes, height)]);
}

export function buildElectronicsStandoffPreview(part: PartFamilySpec): PreviewScene {
  const p = part.parameters as Params; const radius = Number(p.outerDiameter) / 2, height = Number(p.height);
  const baseHeight = p.baseHeight == null ? 0 : Number(p.baseHeight); const baseRadius = p.baseDiameter == null ? radius : Number(p.baseDiameter) / 2;
  const objects: PreviewScene['objects'] = [];
  if (baseHeight > 0) objects.push({id: 'base', kind: 'cylinder', positionMm: {x: 0, y: 0, z: baseHeight / 2}, radiusMm: baseRadius, depthMm: baseHeight, axis: 'z', material: 'body'});
  objects.push({id: 'body', kind: 'cylinder', positionMm: {x: 0, y: 0, z: baseHeight + height / 2}, radiusMm: radius, depthMm: height, axis: 'z', material: 'body'});
  objects.push({id: 'center-hole', kind: 'hole_marker', positionMm: {x: 0, y: 0, z: (baseHeight + height) / 2}, radiusMm: Number(p.holeDiameter) / 2, depthMm: baseHeight + height, axis: 'z', material: 'hole'});
  if (p.counterbore) objects.push({id: 'counterbore', kind: 'hole_marker', positionMm: {x: 0, y: 0, z: baseHeight + height - Number(p.counterbore.depth ?? 0) / 2}, radiusMm: Number(p.counterbore.diameter ?? p.holeDiameter) / 2, depthMm: Number(p.counterbore.depth ?? height), axis: 'z', material: 'reference'});
  return scene(part, {x: baseRadius * 2, y: baseRadius * 2, z: baseHeight + height}, objects);
}

export function buildRoundedRectangularPlatePreview(part: PartFamilySpec): PreviewScene {
  const p = part.parameters as Params; const length = Number(p.length), width = Number(p.width), thickness = Number(p.thickness);
  return scene(part, {x: length, y: width, z: thickness}, [{id: 'body', kind: 'rounded_box', positionMm: {x: 0, y: 0, z: thickness / 2}, dimensionsMm: {x: length, y: width, z: thickness}, radiusMm: Number(p.cornerRadius), material: 'body'}, ...holeMarkers(p.holes, thickness)]);
}
