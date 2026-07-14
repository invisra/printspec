import { num, type Params } from "./common.js";
export function resolveLBracketGeometry(q: Params) {
  const legLengthA = num(q.legLengthA, 40),
    legLengthB = num(q.legLengthB, 40),
    width = num(q.width, 20),
    thickness = num(q.thickness, 4);
  const holeDiameter = num(q.holeDiameter, 0),
    holesPerLeg = Math.max(0, Math.floor(num(q.holesPerLeg, 0)));
  const holes = Array.from({ length: holesPerLeg }, (_, i) => ({
    aX: ((i + 1) * legLengthA) / (holesPerLeg + 1),
    bZ: ((i + 1) * legLengthB) / (holesPerLeg + 1),
  }));
  return {
    legLengthA,
    legLengthB,
    width,
    thickness,
    holeDiameter,
    holesPerLeg,
    holes,
  };
}
