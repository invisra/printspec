import { num, type Params } from "./common.js";
export function resolveWallMountBracketGeometry(q: Params) {
  const width = num(q.width, 40),
    height = num(q.height, 60),
    thickness = num(q.thickness, 4),
    tabDepth = num(q.tabDepth, 20);
  const screwHoleDiameter = num(q.screwHoleDiameter, 4),
    screwHoleSpacing = num(q.screwHoleSpacing, 36);
  const screwHoles = [-screwHoleSpacing / 2, screwHoleSpacing / 2].map((dz) => ({
    x: 0,
    y: -thickness / 2,
    z: height / 2 + dz,
  }));
  return { width, height, thickness, tabDepth, screwHoleDiameter, screwHoleSpacing, screwHoles };
}
