import {num, type Params} from './common.js';
export function resolveDrawerDividerGeometry(q: Params) {
  const length = num(q.length, 120), height = num(q.height, 40), thickness = num(q.thickness, 3);
  const notchCount = Math.max(0, Math.floor(num(q.notchCount, 0))), notchWidth = num(q.notchWidth, 3), notchDepth = num(q.notchDepth, 10);
  const notches = Array.from({length: notchCount}, (_, i) => ({x: -length / 2 + (i + 1) * length / (notchCount + 1), z: height - notchDepth / 2}));
  return {length, height, thickness, notchCount, notchWidth, notchDepth, notches, endTab: q.endTab === true};
}
