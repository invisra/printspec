import {num, type Params} from './common.js';

export function resolveProjectEnclosureTrayGeometry(q: Params) {
  const outerWidth = num(q.outerWidth, 80), outerDepth = num(q.outerDepth, 50);
  const wallHeight = num(q.wallHeight, 15), wallThickness = num(q.wallThickness, 3), floorThickness = num(q.floorThickness, 3);
  const mountHoleDiameter = num(q.mountHoleDiameter, 3), mountHoleInset = num(q.mountHoleInset, 8);
  const innerWidth = Math.max(0, outerWidth - 2 * wallThickness), innerDepth = Math.max(0, outerDepth - 2 * wallThickness);
  const mountHoles = mountHoleDiameter > 0 ? [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({x: sx * (outerWidth / 2 - mountHoleInset), y: sy * (outerDepth / 2 - mountHoleInset)}))) : [];
  return {outerWidth, outerDepth, wallHeight, wallThickness, floorThickness, totalHeight: floorThickness + wallHeight, innerWidth, innerDepth, mountHoleDiameter, mountHoleInset, mountHoles};
}
