// Minimal stub of the subset of brepjs's fluent + functional API surface
// used by generateComposablePartBrepJs (packages/typescript/src/generators/
// brepjs.composable.ts). This does not model real geometry -- it only
// checks argument shapes and call chains, so that a generated .brep.ts
// module can actually be imported and its default export invoked without
// installing the real (WASM, Node >=24) brepjs package. This catches
// syntax errors and API-shape mistakes in the generated *text* (wrong arg
// counts, missing unwrap(), wrong argument types) that a string-snapshot
// comparison alone cannot, since a snapshot only checks the generator's
// output against itself, not that the output is valid, executable code.
// It is deliberately not a substitute for real geometric verification.

class FakeShape {
  constructor(kind, meta = {}) {
    this.kind = kind;
    this.meta = meta;
  }
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

export function box(w, d, h) {
  if (![w, d, h].every(isFiniteNumber))
    throw new Error(`box() got non-finite arg: ${JSON.stringify([w, d, h])}`);
  return new FakeShape("box", { w, d, h });
}

export function cylinder(r, h) {
  if (![r, h].every(isFiniteNumber))
    throw new Error(`cylinder() got non-finite arg: ${JSON.stringify([r, h])}`);
  return new FakeShape("cylinder", { r, h });
}

export function cone(r1, r2, h) {
  if (![r1, r2, h].every(isFiniteNumber))
    throw new Error(`cone() got non-finite arg: ${JSON.stringify([r1, r2, h])}`);
  return new FakeShape("cone", { r1, r2, h });
}

export function sphere(r) {
  if (!isFiniteNumber(r)) throw new Error(`sphere() got non-finite arg: ${JSON.stringify([r])}`);
  return new FakeShape("sphere", { r });
}

export function torus(majorRadius, minorRadius) {
  if (![majorRadius, minorRadius].every(isFiniteNumber))
    throw new Error(`torus() got non-finite arg: ${JSON.stringify([majorRadius, minorRadius])}`);
  return new FakeShape("torus", { majorRadius, minorRadius });
}

export function ellipsoid(rx, ry, rz) {
  if (![rx, ry, rz].every(isFiniteNumber))
    throw new Error(`ellipsoid() got non-finite arg: ${JSON.stringify([rx, ry, rz])}`);
  return new FakeShape("ellipsoid", { rx, ry, rz });
}

class FakeResult {
  constructor(value) {
    this.value = value;
    this.ok = true;
  }
}
export function unwrap(result) {
  if (!(result instanceof FakeResult))
    throw new Error(`unwrap() expected a Result, got: ${JSON.stringify(result)}`);
  return result.value;
}

class FakeEdge {
  constructor(p1, p2) {
    this.p1 = p1;
    this.p2 = p2;
  }
}
function isPoint3(p) {
  return Array.isArray(p) && p.length === 3 && p.every(isFiniteNumber);
}
export function line(p1, p2) {
  if (!isPoint3(p1) || !isPoint3(p2))
    throw new Error(`line() expected two [x,y,z] points, got: ${JSON.stringify([p1, p2])}`);
  return new FakeEdge(p1, p2);
}

export function threePointArc(p1, p2, p3) {
  if (![p1, p2, p3].every(isPoint3))
    throw new Error(`threePointArc() expected three [x,y,z] points, got: ${JSON.stringify([p1, p2, p3])}`);
  return new FakeEdge(p1, p3);
}

export function bezier(points) {
  if (!Array.isArray(points) || points.length < 2 || !points.every(isPoint3))
    throw new Error(`bezier() expected an array of at least two [x,y,z] points, got: ${JSON.stringify(points)}`);
  return new FakeResult(new FakeEdge(points[0], points[points.length - 1]));
}

export function bsplineApprox(points) {
  if (!Array.isArray(points) || points.length < 2 || !points.every(isPoint3))
    throw new Error(`bsplineApprox() expected an array of at least two [x,y,z] points, got: ${JSON.stringify(points)}`);
  return new FakeResult(new FakeEdge(points[0], points[points.length - 1]));
}

class FakeWire {
  constructor(edges) {
    this.edges = edges;
  }
}
export function wireLoop(edges) {
  if (!Array.isArray(edges) || edges.length === 0 || edges.some((e) => !(e instanceof FakeEdge)))
    throw new Error(`wireLoop() expected a non-empty array of edges, got: ${JSON.stringify(edges)}`);
  return new FakeResult(new FakeWire(edges));
}

export function wire(edges) {
  if (!Array.isArray(edges) || edges.length === 0 || edges.some((e) => !(e instanceof FakeEdge)))
    throw new Error(`wire() expected a non-empty array of edges, got: ${JSON.stringify(edges)}`);
  return new FakeResult(new FakeWire(edges));
}

class FakeFace {
  constructor(wire) {
    this.wire = wire;
  }
}
export function face(wire) {
  if (!(wire instanceof FakeWire)) throw new Error(`face() expected a closed wire, got: ${JSON.stringify(wire)}`);
  return new FakeResult(new FakeFace(wire));
}

// extrude(face, height: number | Vec3): both forms are accepted by real
// brepjs (a plain number extrudes along Z; a Vec3 extrudes along that
// direction, with the vector's own length as the distance), so this stub
// accepts either shape without favoring one.
export function extrude(f, height) {
  if (!(f instanceof FakeFace)) throw new Error(`extrude() expected a face, got: ${JSON.stringify(f)}`);
  const validHeight = isFiniteNumber(height) || (Array.isArray(height) && height.length === 3 && height.every(isFiniteNumber));
  if (!validHeight)
    throw new Error(`extrude() expected a number or [x,y,z] direction, got: ${JSON.stringify(height)}`);
  return new FakeResult(new FakeShape("extrude", { face: f, height }));
}

export function revolve(f, options) {
  if (!(f instanceof FakeFace)) throw new Error(`revolve() expected a face, got: ${JSON.stringify(f)}`);
  if (options !== undefined && (typeof options !== "object" || options === null))
    throw new Error(`revolve() expected an options object, got: ${JSON.stringify(options)}`);
  return new FakeResult(new FakeShape("revolve", { face: f, options }));
}

export function loft(wires, options) {
  if (!Array.isArray(wires) || wires.length < 2 || wires.some((w) => !(w instanceof FakeWire)))
    throw new Error(`loft() expected an array of at least two wires, got: ${JSON.stringify(wires)}`);
  return new FakeResult(new FakeShape("loft", { wires, options }));
}

export function sweep(profileWire, spineWire, config, shellMode) {
  if (!(profileWire instanceof FakeWire))
    throw new Error(`sweep() expected a closed profile wire, got: ${JSON.stringify(profileWire)}`);
  if (!(spineWire instanceof FakeWire))
    throw new Error(`sweep() expected a spine wire, got: ${JSON.stringify(spineWire)}`);
  if (config !== undefined && (typeof config !== "object" || config === null))
    throw new Error(`sweep() expected a config object, got: ${JSON.stringify(config)}`);
  return new FakeResult(new FakeShape("sweep", { profileWire, spineWire, config, shellMode }));
}

export function thread(options) {
  if (!options || !isFiniteNumber(options.radius))
    throw new Error(`thread() expected {radius: number, ...}, got: ${JSON.stringify(options)}`);
  if (!isFiniteNumber(options.pitch))
    throw new Error(`thread() expected a numeric pitch, got: ${JSON.stringify(options)}`);
  if (!isFiniteNumber(options.height))
    throw new Error(`thread() expected a numeric height, got: ${JSON.stringify(options)}`);
  return new FakeResult(new FakeShape("thread", { options }));
}

class FakeFoundFace {
  constructor(meta) {
    this.meta = meta;
  }
}

class FakeFaceFinder {
  constructor(filters = []) {
    this.filters = filters;
  }
  atDistance(distance, point) {
    if (!isFiniteNumber(distance))
      throw new Error(`atDistance() expected a numeric distance, got: ${distance}`);
    if (!isPoint3(point))
      throw new Error(`atDistance() expected an [x,y,z] point, got: ${JSON.stringify(point)}`);
    return new FakeFaceFinder([...this.filters, { distance, point }]);
  }
  findAll(s) {
    if (!(s instanceof FakeShape)) throw new Error(`findAll() expected a shape, got: ${JSON.stringify(s)}`);
    return [new FakeFoundFace({ filters: this.filters, shape: s })];
  }
  findUnique(s) {
    if (!(s instanceof FakeShape)) throw new Error(`findUnique() expected a shape, got: ${JSON.stringify(s)}`);
    return new FakeResult(new FakeFoundFace({ filters: this.filters, shape: s }));
  }
}
export function faceFinder() {
  return new FakeFaceFinder();
}

class FakeFoundEdge {
  constructor(meta) {
    this.meta = meta;
  }
}
export function edgesOfFace(f) {
  if (!(f instanceof FakeFoundFace)) throw new Error(`edgesOfFace() expected a face, got: ${JSON.stringify(f)}`);
  return [new FakeFoundEdge({ face: f })];
}

class FakeEdgeFinder {
  findAll(s) {
    if (!(s instanceof FakeShape)) throw new Error(`findAll() expected a shape, got: ${JSON.stringify(s)}`);
    return [new FakeFoundEdge({ shape: s })];
  }
}
export function edgeFinder() {
  return new FakeEdgeFinder();
}
function isEdgesArg(a) {
  return typeof a === "function" || (Array.isArray(a) && a.every((e) => e instanceof FakeFoundEdge));
}

// loadFont/sketchText (from the real 'brepjs/text' subpath) are stubbed
// offline -- no real fetch, no real font parsing -- since tests must run
// without network access; this only checks argument shapes and call
// chains, the same scope as everything else in this file.
export async function loadFont(fontPath, fontFamily) {
  if (typeof fontPath !== "string" || fontPath.length === 0)
    throw new Error(`loadFont() expected a URL string, got: ${JSON.stringify(fontPath)}`);
  return new FakeResult({ fontFamily });
}

class FakeSketches {
  constructor(meta) {
    this.meta = meta;
  }
  extrude(depth) {
    if (!isFiniteNumber(depth)) throw new Error(`Sketches.extrude() expected a number, got: ${depth}`);
    return new FakeShape("textExtrude", { ...this.meta, depth });
  }
}
export function sketchText(text, textConfig) {
  if (typeof text !== "string" || text.length === 0)
    throw new Error(`sketchText() expected a non-empty string, got: ${JSON.stringify(text)}`);
  return new FakeSketches({ text, textConfig });
}

class Wrapper {
  constructor(s) {
    if (!(s instanceof FakeShape)) throw new Error(`shape() got a non-shape: ${JSON.stringify(s)}`);
    this.s = s;
  }
  get val() {
    return this.s;
  }
  fuse(other) {
    return new Wrapper(new FakeShape("fuse", { a: this.s, b: other }));
  }
  cut(other) {
    return new Wrapper(new FakeShape("cut", { a: this.s, b: other }));
  }
  intersect(other) {
    return new Wrapper(new FakeShape("intersect", { a: this.s, b: other }));
  }
  cutAll(others) {
    if (!Array.isArray(others)) throw new Error("cutAll() expected an array");
    return new Wrapper(new FakeShape("cutAll", { a: this.s, others }));
  }
  translate(vec) {
    if (!isPoint3(vec)) throw new Error(`translate() expected [x,y,z] numbers, got: ${JSON.stringify(vec)}`);
    return new Wrapper(new FakeShape("translate", { a: this.s, vec }));
  }
  rotate(deg, opts) {
    if (!isFiniteNumber(deg)) throw new Error(`rotate() expected a number, got: ${deg}`);
    if (!opts || !Array.isArray(opts.axis)) throw new Error(`rotate() expected {axis: [x,y,z]}, got: ${JSON.stringify(opts)}`);
    return new Wrapper(new FakeShape("rotate", { a: this.s, deg, opts }));
  }
  fillet(a, b) {
    if (!isEdgesArg(a))
      throw new Error(`fillet() expected an edge finder function or edge array, got: ${JSON.stringify(a)}`);
    if (!isFiniteNumber(b)) throw new Error(`fillet() expected a numeric radius, got: ${b}`);
    return new Wrapper(new FakeShape("fillet", { a: this.s, arg1: a, arg2: b }));
  }
  chamfer(a, b) {
    if (!isEdgesArg(a))
      throw new Error(`chamfer() expected an edge finder function or edge array, got: ${JSON.stringify(a)}`);
    if (!isFiniteNumber(b)) throw new Error(`chamfer() expected a numeric distance, got: ${b}`);
    return new Wrapper(new FakeShape("chamfer", { a: this.s, arg1: a, arg2: b }));
  }
  shell(faces, thickness) {
    if (!Array.isArray(faces) || faces.some((f) => !(f instanceof FakeFoundFace)))
      throw new Error(`shell() expected an array of faces, got: ${JSON.stringify(faces)}`);
    if (faces.length === 0) throw new Error("shell() expected at least one face");
    if (!isFiniteNumber(thickness))
      throw new Error(`shell() expected a numeric thickness, got: ${thickness}`);
    return new Wrapper(new FakeShape("shell", { a: this.s, faces, thickness }));
  }
}

export function shape(s) {
  return new Wrapper(s);
}
