import {num, type Params} from './common.js';

export function resolveCableCombGeometry(q: Params) {
  const slotCount = Math.max(0, Math.floor(num(q.slotCount, 6)));
  const slotWidth = num(q.slotWidth, 4);
  const slotSpacing = num(q.slotSpacing, 12);
  const toothWidth = num(q.toothWidth, Math.max(1, slotSpacing - slotWidth));
  const slotDepth = num(q.slotDepth, 8);
  const thickness = num(q.baseThickness, num(q.thickness, 3));
  const length = num(q.length, slotCount * slotWidth + (slotCount + 1) * toothWidth);
  const width = num(q.width, slotDepth + toothWidth);
  const pitch = slotSpacing || slotWidth + toothWidth;
  const occupied = slotCount > 1 ? (slotCount - 1) * pitch + slotWidth : slotWidth;
  const startX = -occupied / 2 + slotWidth / 2;
  const slots = Array.from({length: slotCount}, (_, i) => ({x: startX + i * pitch, y: width / 2 - slotDepth / 2}));
  return {slotCount, slotWidth, slotSpacing: pitch, toothWidth, slotDepth, thickness, length, width, slots};
}
