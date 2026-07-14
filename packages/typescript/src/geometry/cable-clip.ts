import { num, type Params } from "./common.js";

export function resolveCableClipGeometry(q: Params) {
  const baseLength = num(q.baseLength, 28),
    baseWidth = num(q.baseWidth, num(q.width, 12)),
    baseThickness = num(q.baseThickness, num(q.thickness, 3));
  const innerDiameter = num(q.clipInnerDiameter, num(q.cableDiameter, 6));
  const wallThickness = num(q.clipWallThickness, num(q.thickness, 2));
  const openingWidth = num(q.clipOpeningWidth, Math.max(innerDiameter * 0.45, wallThickness * 1.5));
  const outerDiameter = innerDiameter + 2 * wallThickness;
  const centerZ = baseThickness + outerDiameter / 2;
  return {
    baseLength,
    baseWidth,
    baseThickness,
    innerDiameter,
    wallThickness,
    openingWidth,
    outerDiameter,
    centerZ,
  };
}
