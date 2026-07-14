// composable_part -> CadQuery generator.
//
// Mirrors brepjs.composable.ts's structure and design closely (see that
// file's own module doc for the full rationale behind the position/
// rotation/pattern/group resolution model) -- both generators share the
// exact same position-resolution engine via composable.shared.ts, so this
// file only needs its own CadQuery-specific *geometry construction and code
// emission*. Every mapping from a brepjs call to its CadQuery equivalent
// below was checked against the real, installed `cadquery` package (not
// assumed), matching this project's established discipline for brepjs:
//
//  - `cq.Solid.makeBox/makeCylinder(...)` already place Z=0 at the base,
//    exactly like brepjs's `box()`/`cylinder()` -- no shift needed.
//  - `cq.Solid.makeSphere(radius)` -- unlike brepjs's `sphere()` -- defaults
//    to a HALF sphere (a hemisphere, angleDegrees1=0/angleDegrees2=90):
//    real-kernel-verified (volume was exactly half the full-sphere formula
//    before, and exactly matched it after passing angleDegrees1=-90). Never
//    call makeSphere() without explicit angleDegrees1=-90, angleDegrees2=90.
//  - `cq.Solid.makeTorus(majorRadius, minorRadius)` centers at its own
//    origin by default, same as brepjs's `torus()` -- same up-shift needed.
//  - There is no `makeEllipsoid`; a full sphere non-uniformly scaled via
//    `.transformGeometry(cq.Matrix([[rx,0,0,0],[0,ry,0,0],[0,0,rz,0]]))`
//    real-kernel-verified to produce a valid ellipsoid solid with a small
//    inherent volume-measurement tolerance, the same characteristic
//    brepjs's own `ellipsoid()` primitive already has.
//  - `cq.Solid.extrudeLinear(wire, [], vecNormal)`/`.revolve(wire, [],
//    angleDegrees, axisStart, axisEnd)`/`.makeLoft([wires])`/`.sweep(wire,
//    [], path, transitionMode=...)` all take a `Wire` directly -- unlike
//    brepjs, no separate `face()` step is needed at all, and
//    `extrudeLinear`'s explicit direction vector means rib/wedge's vertical
//    XZ-plane profile needs no special-casing the way brepjs's `extrude()`
//    (which only extrudes along Z when given a plain number) does.
//  - `cq.Solid.sweep(..., transitionMode=...)` real-kernel-verified to
//    match brepjs's own findings almost exactly: the default
//    (`"transformed"`) produces invalid, degenerate geometry at a bend, and
//    `"round"` is valid with the *same* volume brepjs's own "round" sweep
//    produces for an identical bent path (789.568/316.566-class exact
//    cross-generator agreement, both wrapping the same underlying OCCT).
//    Surprisingly, CadQuery's own `"right"` (sharp miter) *was* found valid
//    here (unlike brepjs's), but `"round"` is used unconditionally anyway,
//    for consistency between the two generators' output, not just because
//    it's the only safe option in this one.
//  - Boolean ops (`.fuse()/.cut()/.intersect()`), `.translate()`, and
//    `.rotate()` are plain instance methods directly on the accumulated
//    `Shape`/`Solid`/`Compound` -- no `shape()`-style wrapper needed the way
//    brepjs's fluent API requires. `.rotate(axisStartPoint, axisEndPoint,
//    angleDegrees)` real-kernel-verified to rotate in the same direction
//    (right-hand rule about the given axis) as `rotateExtrinsic()`'s own
//    math, so no sign flip is needed versus brepjs's `.rotate(deg, {axis})`.
//  - `.fillet(radius, edgeList)` and `.chamfer(distance, None, edgeList)`
//    real-kernel-verified to match brepjs's own hand-derived volumes
//    exactly (a Minkowski-sum-style full box round-over, a vertical-only
//    fillet, a chamfer) for identical inputs -- argument order is reversed
//    from brepjs's `.fillet(edges, radius)`.
//  - Shelling is `shape.hollow(faceList, thickness)`, NOT a same-named
//    `.shell()` (that's an unrelated shell-*selector*) -- and its sign
//    convention is the *opposite* of brepjs's: a positive `thickness`
//    shells outward, so printspec's own "thickness measured inward"
//    convention needs the *negated* value, real-kernel-verified to produce
//    the exact expected wall thickness.
//  - `shape.edges()` (no selector) returns every edge, matching brepjs's
//    `edgeFinder().findAll()` for "all"; `shape.edges(cq.ParallelDirSelector(
//    cq.Vector(x, y, z)))` matches a direction-vector edge filter for
//    "vertical" (including a rotated target, real-kernel-verified against
//    the same rotated-box hand formula brepjs's own "vertical" fillet
//    used); `face.Edges()` matches `edgesOfFace()` for "top"/"bottom".
//  - `shape.faces(cq.NearestToPointSelector(point))` matches brepjs's
//    `faceFinder().atDistance(0, point).findUnique()` face-identification
//    technique exactly, including for a rotated target.
//
// `thread` is not implemented by this generator (CadQuery has no built-in
// helical thread primitive analogous to brepjs's `thread()`; replicating it
// would need a hand-built tooth-profile helix sweep, deliberately deferred).
// `text` is also not implemented here: CadQuery's `Workplane.text()` needs a
// system font name or a local font *file path*, not brepjs's fetchable
// `fontUrl`, a genuinely different architecture rather than a direct port.
// A `thread` or `text` feature is dropped with a clear warning, the same
// pattern already used for an unsupported (kind, edges)/(kind, face)
// combination elsewhere in this generator.

import { cadqueryNumber as n } from "./cadquery.core.js";
import {
  type Vec3,
  ZERO,
  addV,
  rotateExtrinsic,
  pointsBoundingBox,
  revolveProfileExtents,
  localAnchor,
  effectiveRelation,
  patternOffsets,
  buildResolver,
  checkAssemblyConnectivity,
  checkClearanceConstraints,
} from "./composable.shared.js";

// A 3D point as a Python tuple literal.
function pt3(x: unknown, y: unknown, z: unknown): string {
  return `(${n(x)}, ${n(y)}, ${n(z)})`;
}

// Builds the list of edge expressions for a closed profile loop
// (extruded_profile's XY footprint or revolved_profile's (radius, z)
// half-plane), honoring each vertex's optional `curve` -- an arc through a
// given point (CadQuery's `cq.Edge.makeThreePointArc(start, through, end)`,
// real-kernel-verified to bulge through exactly the given point, matching
// the same hand-derived semicircle-segment area brepjs's own threePointArc
// does), a Bezier through one or more control points
// (`cq.Edge.makeBezier([start, ...controls, end])`, real-kernel-verified
// against the same quadratic-Bezier area-vs-chord formula), or a smooth
// B-spline through one or more points (`cq.Edge.makeSplineApprox([...])`,
// needing each point wrapped in `cq.Vector` -- unlike makeLine/
// makeThreePointArc/makeBezier, which accept plain tuples directly --
// real-kernel-verified to produce the exact same volume as brepjs's own
// bsplineApprox() for an identical asymmetric bulge test) -- instead of
// always connecting consecutive vertices with a straight line. `shift` maps
// a raw authored point to its shifted, formatted [a, b] pair (centered XY
// for extruded_profile, Z-shifted for revolved_profile); `toPoint3` wraps a
// shifted pair into the 3D point tuple string makeLine()/makeThreePointArc()/
// makeBezier()/makeSplineApprox() expect (for example `(x, y, 0)` or
// `(r, 0, z)`).
function buildProfileEdges(
  points: { curve?: any }[],
  shift: (p: any) => [string, string],
  toPoint3: (pair: [string, string]) => string,
): string[] {
  const pts = points.map(shift);
  return pts.map((pair, i) => {
    const nextPair = pts[(i + 1) % pts.length];
    const from = toPoint3(pair);
    const to = toPoint3(nextPair);
    const curve = points[i]?.curve;
    if (curve?.type === "arc") {
      const through = toPoint3(shift(curve.through));
      return `    cq.Edge.makeThreePointArc(${from}, ${through}, ${to}),`;
    }
    if (curve?.type === "bezier") {
      const ctrl = curve.controlPoints.map((p: any) => toPoint3(shift(p)));
      return `    cq.Edge.makeBezier([${from}, ${ctrl.join(", ")}, ${to}]),`;
    }
    if (curve?.type === "spline") {
      const through = curve.through.map(
        (p: any) => `cq.Vector${toPoint3(shift(p))}`,
      );
      return `    cq.Edge.makeSplineApprox([cq.Vector${from}, ${through.join(", ")}, cq.Vector${to}]),`;
    }
    return `    cq.Edge.makeLine(${from}, ${to}),`;
  });
}

// AABB half-extents/full-Z-extent-based footprint math (aabbExtents,
// localAnchor, patternOffsets, buildResolver, checkAssemblyConnectivity,
// checkClearanceConstraints) is shared verbatim with brepjs via
// composable.shared.ts -- see that module's own doc.

// Wraps a CadQuery shape expression with rotate/translate calls for a
// resolved transform, skipping any axis/translation that's exactly zero to
// keep generated code readable, mirroring brepjs's own applyTransform()
// exactly (including emitting three separate world-axis rotations, X then Y
// then Z, matching the extrinsic point math used for anchor resolution).
// `.rotate(axisStart, axisEnd, angleDegrees)` rotates about the line through
// the two given points -- (0,0,0) to a unit axis point gives a rotation
// about that world axis through the origin, real-kernel-verified to rotate
// in the same direction rotateExtrinsic()'s own math does.
function applyTransform(expr: string, rotation: Vec3, position: Vec3): string {
  let out = expr;
  const axes: Array<[number, string]> = [
    [rotation[0], "(1, 0, 0)"],
    [rotation[1], "(0, 1, 0)"],
    [rotation[2], "(0, 0, 1)"],
  ];
  for (const [deg, axis] of axes)
    if (deg !== 0) out = `${out}.rotate((0, 0, 0), ${axis}, ${n(deg)})`;
  if (position[0] !== 0 || position[1] !== 0 || position[2] !== 0)
    out = `${out}.translate(${pt3(position[0], position[1], position[2])})`;
  return out;
}

// Builds a single component instance's local geometry (before its own
// rotation/position/group transform is applied). See brepjs.composable.ts's
// own buildComponentGeometry() for the per-kind rationale (identical here);
// only the CadQuery call surface differs, per this module's own doc.
function buildComponentGeometry(kind: string, dims: any): string {
  const centeredBox = (l: unknown, w: unknown, h: unknown) =>
    `cq.Solid.makeBox(${n(l)}, ${n(w)}, ${n(h)}).translate(${pt3(-Number(l) / 2, -Number(w) / 2, 0)})`;
  switch (kind) {
    case "box":
      return centeredBox(dims.length, dims.width, dims.height);
    case "rounded_box": {
      const base = centeredBox(dims.length, dims.width, dims.height);
      if (!(dims.radius > 0)) return base;
      // Python's walrus operator lets this stay one expression (needed
      // since buildComponentGeometry() must return a single value usable
      // anywhere -- inline, patterned, or further transformed) while still
      // referring to the un-filleted box twice: once to fillet it, once to
      // find its own vertical edges to fillet. Real-kernel-verified safe to
      // reuse the same `_rb` name even when two rounded_box instances (for
      // example from a pattern) appear in the same combined expression --
      // each `:=` rebinds it sequentially, read back immediately after.
      return (
        `(_rb := ${base}).fillet(${n(dims.radius)}, list(_rb.edges(` +
        `cq.ParallelDirSelector(cq.Vector(0, 0, 1)))))`
      );
    }
    case "cylinder":
    case "boss":
      return `cq.Solid.makeCylinder(${n(dims.diameter / 2)}, ${n(dims.height)})`;
    case "tube": {
      const outer = `cq.Solid.makeCylinder(${n(dims.outerDiameter / 2)}, ${n(dims.height)})`;
      const inner = `cq.Solid.makeCylinder(${n(dims.innerDiameter / 2)}, ${n(dims.height)} + 0.2).translate(${pt3(0, 0, -0.1)})`;
      return `${outer}.cut(${inner})`;
    }
    case "plate":
    case "tab":
      return centeredBox(dims.length, dims.width, dims.thickness);
    case "rib": {
      // A right-triangle gusset profile in the XZ plane at y0 =
      // -thickness/2, extruded along +Y by `thickness` -- full height at
      // the wall end (x0), tapering to zero at the far end (x1). Unlike
      // brepjs's extrude() (which only extrudes along Z given a plain
      // number, needing an explicit [0, h, 0] workaround), CadQuery's
      // extrudeLinear() always takes an explicit direction vector, so no
      // special-casing is needed here at all.
      const t = n(dims.thickness);
      const h = n(dims.height);
      const x0 = n(-dims.length / 2);
      const x1 = n(dims.length / 2);
      const y0 = n(-dims.thickness / 2);
      return (
        `cq.Solid.extrudeLinear(cq.Wire.assembleEdges([\n` +
        `    cq.Edge.makeLine((${x0}, ${y0}, 0), (${x1}, ${y0}, 0)),\n` +
        `    cq.Edge.makeLine((${x1}, ${y0}, 0), (${x0}, ${y0}, ${h})),\n` +
        `    cq.Edge.makeLine((${x0}, ${y0}, ${h}), (${x0}, ${y0}, 0)),\n` +
        `]), [], (0, ${t}, 0))`
      );
    }
    case "wedge": {
      // A right-triangle profile in the XZ plane at y0 = -width/2, extruded
      // along +Y by `width`.
      const w = n(dims.width);
      const h = n(dims.height);
      const x0 = n(-dims.length / 2);
      const x1 = n(dims.length / 2);
      const y0 = n(-dims.width / 2);
      return (
        `cq.Solid.extrudeLinear(cq.Wire.assembleEdges([\n` +
        `    cq.Edge.makeLine((${x0}, ${y0}, 0), (${x1}, ${y0}, 0)),\n` +
        `    cq.Edge.makeLine((${x1}, ${y0}, 0), (${x0}, ${y0}, ${h})),\n` +
        `    cq.Edge.makeLine((${x0}, ${y0}, ${h}), (${x0}, ${y0}, 0)),\n` +
        `]), [], (0, ${w}, 0))`
      );
    }
    case "extruded_profile": {
      // An arbitrary polygon footprint in the XY plane at Z=0, extruded
      // along +Z by `height`, bounding-box-centered at the component's
      // local origin -- the same convention as brepjs's own
      // extruded_profile, sharing the exact same pointsBoundingBox().
      const { minX, maxX, minY, maxY } = pointsBoundingBox(dims.points);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const shift = (p: { x: number; y: number }): [string, string] => [
        n(p.x - cx),
        n(p.y - cy),
      ];
      const lines = buildProfileEdges(
        dims.points,
        shift,
        ([x, y]) => `(${x}, ${y}, 0)`,
      );
      return (
        `cq.Solid.extrudeLinear(cq.Wire.assembleEdges([\n` +
        `${lines.join("\n")}\n` +
        `  ]), [], ${pt3(0, 0, dims.height)})`
      );
    }
    case "sphere":
      // cq.Solid.makeSphere(radius) defaults to a HALF sphere
      // (angleDegrees1=0, angleDegrees2=90) -- real-kernel-verified;
      // angleDegrees1=-90 is required for a full sphere. Then shift up by
      // its own radius, matching brepjs's own sphere() shift (it also
      // centers at its own origin by default).
      return (
        `cq.Solid.makeSphere(${n(dims.diameter / 2)}, angleDegrees1=-90, angleDegrees2=90)` +
        `.translate(${pt3(0, 0, dims.diameter / 2)})`
      );
    case "torus": {
      const minorRadius = dims.tubeDiameter / 2;
      const majorRadius = (dims.outerDiameter - dims.tubeDiameter) / 2;
      return `cq.Solid.makeTorus(${n(majorRadius)}, ${n(minorRadius)}).translate(${pt3(0, 0, minorRadius)})`;
    }
    case "ellipsoid":
      // No makeEllipsoid primitive -- a unit full sphere, non-uniformly
      // scaled via transformGeometry() with a diagonal cq.Matrix, real-
      // kernel-verified to produce a valid ellipsoid solid (with the same
      // small inherent volume-measurement tolerance brepjs's own
      // ellipsoid() primitive already has). Shift up by its own Z
      // half-length, matching brepjs's convention.
      return (
        `cq.Solid.makeSphere(1.0, angleDegrees1=-90, angleDegrees2=90).transformGeometry(\n` +
        `    cq.Matrix([[${n(dims.lengthX / 2)}, 0, 0, 0], [0, ${n(dims.lengthY / 2)}, 0, 0], [0, 0, ${n(dims.lengthZ / 2)}, 0]])\n` +
        `  ).translate(${pt3(0, 0, dims.lengthZ / 2)})`
      );
    case "revolved_profile": {
      // An arbitrary polygon cross-section in the (radius, z) half-plane
      // (X=radius, Y=0), revolved around Z via CadQuery's real
      // cq.Solid.revolve() operation. radius is never shifted or centered
      // -- the revolve axis (radius=0) is a fixed reference; z is shifted
      // so the profile's own minimum lands at 0.
      const { minZ } = revolveProfileExtents(dims.points);
      const shift = (p: { radius: number; z: number }): [string, string] => [
        n(p.radius),
        n(p.z - minZ),
      ];
      const lines = buildProfileEdges(
        dims.points,
        shift,
        ([r, z]) => `(${r}, 0, ${z})`,
      );
      const sweepAngle = dims.sweepAngle ?? 360;
      return (
        `cq.Solid.revolve(cq.Wire.assembleEdges([\n` +
        `${lines.join("\n")}\n` +
        `  ]), [], ${n(sweepAngle)}, (0, 0, 0), (0, 0, 1))`
      );
    }
    case "loft_profile": {
      // Blends between 2+ cross-sectional profiles via CadQuery's real
      // cq.Solid.makeLoft(wires) operation, real-kernel-verified to already
      // return a capped, valid Solid directly (no separate end-capping
      // needed), matching brepjs's own loft() finding exactly. Every
      // profile is centered on its own local origin independently.
      const zs = dims.profiles.map((p: { z: number }) => p.z);
      const minZ = Math.min(...zs);
      const wires = dims.profiles.map(
        (profile: { points: any[]; z: number }) => {
          const { minX, maxX, minY, maxY } = pointsBoundingBox(profile.points);
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const shift = (p: { x: number; y: number }): [string, string] => [
            n(p.x - cx),
            n(p.y - cy),
          ];
          const z = n(profile.z - minZ);
          const edges = buildProfileEdges(
            profile.points,
            shift,
            ([x, y]) => `(${x}, ${y}, ${z})`,
          );
          return `cq.Wire.assembleEdges([\n${edges.join("\n")}\n  ])`;
        },
      );
      return `cq.Solid.makeLoft([\n${wires.map((w: string) => `    ${w},`).join("\n")}\n  ])`;
    }
    case "swept_profile": {
      // An arbitrary closed cross-section swept along a straight-line-
      // segment 3D path via CadQuery's real cq.Solid.sweep() operation.
      // Real-kernel testing found this needs the exact same care as
      // brepjs's own sweep(): the profile is not auto-oriented to the
      // spine's tangent, so the path's first segment must run parallel to
      // Z (checked at validation time, shared with brepjs); `profile` is
      // NOT centered, authored directly in the path's own local frame;
      // `transitionMode="round"` is always passed (the default,
      // "transformed", produced invalid geometry at a bend in real-kernel
      // testing here too).
      const p0 = dims.path[0];
      const pathPoints = dims.path.map(
        (p: { x: number; y: number; z: number }) =>
          pt3(p.x - p0.x, p.y - p0.y, p.z - p0.z),
      );
      const spineEdges = pathPoints
        .slice(0, -1)
        .map(
          (from: string, i: number) =>
            `    cq.Edge.makeLine(${from}, ${pathPoints[i + 1]}),`,
        );
      const profileShift = (p: { x: number; y: number }): [string, string] => [
        n(p.x),
        n(p.y),
      ];
      const profileEdges = buildProfileEdges(
        dims.profile,
        profileShift,
        ([x, y]) => `(${x}, ${y}, 0)`,
      );
      return (
        `cq.Solid.sweep(\n` +
        `    cq.Wire.assembleEdges([\n${profileEdges.join("\n")}\n    ]),\n` +
        `    [],\n` +
        `    cq.Wire.assembleEdges([\n${spineEdges.join("\n")}\n    ]),\n` +
        `    transitionMode="round",\n` +
        `  )`
      );
    }
    default:
      return `cq.Solid.makeBox(1, 1, 1)`;
  }
}

// Builds a component's full local geometry, expanding its pattern (if set)
// into a fused union of instances. All instances share the single
// component's id, per docs/composable-parts.md.
function buildPatternedGeometry(kind: string, dims: any, pattern: any): string {
  const base = buildComponentGeometry(kind, dims);
  const offsets = patternOffsets(pattern);
  if (offsets.length <= 1) return base;
  let combined = `${base}.translate(${pt3(offsets[0][0], offsets[0][1], offsets[0][2])})`;
  for (const o of offsets.slice(1)) {
    const instance = `${base}.translate(${pt3(o[0], o[1], o[2])})`;
    combined = `${combined}.fuse(${instance})`;
  }
  return combined;
}

// Builds a feature's full local cutter geometry, expanding its pattern (if
// set) into a fused union of cutter instances -- the cutting equivalent of
// buildPatternedGeometry() above.
function buildPatternedCutExpr(cutExpr: string, pattern: any): string {
  const offsets = patternOffsets(pattern);
  if (offsets.length <= 1) return cutExpr;
  let combined = `${cutExpr}.translate(${pt3(offsets[0][0], offsets[0][1], offsets[0][2])})`;
  for (const o of offsets.slice(1)) {
    const instance = `${cutExpr}.translate(${pt3(o[0], o[1], o[2])})`;
    combined = `${combined}.fuse(${instance})`;
  }
  return combined;
}

// Reorients a Z-axis-built shape to run along x/y instead, using the same
// rotation convention as everywhere else. z is the default/no-op case.
function orientAlongAxis(expr: string, axis: string): string {
  if (axis === "x") return `${expr}.rotate((0, 0, 0), (0, 1, 0), 90)`;
  if (axis === "y") return `${expr}.rotate((0, 0, 0), (1, 0, 0), -90)`;
  return expr;
}

// A hole/slot cut, centered on the feature's resolved position (not
// surface-anchored -- see brepjs.composable.ts's module doc, identical
// reasoning here). depth is generous when "through" is requested.
const THROUGH_DEPTH = 1000;
function resolveDepth(depth: unknown): number {
  return depth === "through" || depth == null ? THROUGH_DEPTH : Number(depth);
}
function holeCutExpr(params: any): string {
  const depth = resolveDepth(params.depth);
  const base = `cq.Solid.makeCylinder(${n(params.diameter / 2)}, ${n(depth + 0.2)}).translate(${pt3(0, 0, -(depth + 0.2) / 2)})`;
  return orientAlongAxis(base, params.axis ?? "z");
}
function slotCutExpr(params: any): string {
  const depth = resolveDepth(params.depth);
  const base = `cq.Solid.makeBox(${n(params.length)}, ${n(params.width)}, ${n(depth + 0.2)}).translate(${pt3(-params.length / 2, -params.width / 2, -(depth + 0.2) / 2)})`;
  return orientAlongAxis(base, params.axis ?? "z");
}
function counterboreCutExpr(params: any): string {
  return `cq.Solid.makeCylinder(${n(params.diameter / 2)}, ${n(params.depth)}).translate(${pt3(0, 0, -params.depth / 2)})`;
}
function countersinkCutExpr(params: any): string {
  const r1 = params.diameter / 2;
  const angleRad = (params.angle * Math.PI) / 180;
  const height = r1 / Math.tan(angleRad / 2);
  return `cq.Solid.makeCone(${n(r1)}, 0.01, ${n(height)}).translate(${pt3(0, 0, -height / 2)})`;
}

// Builds the cut expression for one feature instance, or null for a kind
// that isn't implemented (thread and text, deliberately deferred by this
// generator -- see the module doc -- or fillet/chamfer's stray no-target
// case, handled separately in the main loop).
function buildFeatureCut(feature: any, warnings: string[]): string | null {
  const params = feature.parameters ?? {};
  switch (feature.kind) {
    case "hole":
      if (params.countersink || params.counterbore)
        warnings.push(
          `feature ${feature.id}'s nested countersink/counterbore is not implemented; author it as a separate stacked feature instead`,
        );
      return holeCutExpr(params);
    case "slot":
      return slotCutExpr(params);
    case "counterbore":
      warnings.push(
        `feature ${feature.id} (counterbore) is centered on its resolved position, not precisely surface-anchored; review the Z position before manufacturing`,
      );
      return counterboreCutExpr(params);
    case "countersink":
      warnings.push(
        `feature ${feature.id} (countersink) is centered on its resolved position, not precisely surface-anchored; review the Z position before manufacturing`,
      );
      return countersinkCutExpr(params);
    case "thread":
      warnings.push(
        `feature ${feature.id} (thread) is not implemented by the composable_part CadQuery generator (CadQuery has no built-in helical thread primitive); the thread was not applied`,
      );
      return null;
    case "text":
      warnings.push(
        `feature ${feature.id} (text) is not implemented by the composable_part CadQuery generator (CadQuery's text() needs a local font file, not a fetchable fontUrl); the text was not applied`,
      );
      return null;
    default:
      return null;
  }
}

// Faces reliably shell-able per target kind -- identical support matrix to
// brepjs.composable.ts's SHELL_SUPPORTED_FACES (this generator reuses the
// same real-kernel findings: which faces are flat caps/walls vs. adjacent
// to a curved or filleted surface is a property of the *geometry*, not of
// which kernel binding built it).
const SHELL_SUPPORTED_FACES: Record<string, Set<string>> = {
  box: new Set(["top", "bottom", "front", "back", "left", "right"]),
  plate: new Set(["top", "bottom", "front", "back", "left", "right"]),
  tab: new Set(["top", "bottom", "front", "back", "left", "right"]),
  rounded_box: new Set(["top", "bottom"]),
  cylinder: new Set(["top", "bottom"]),
  boss: new Set(["top", "bottom"]),
};

// Builds the Python list-literal expression for a shell feature's
// `openFaces`, restricted to SHELL_SUPPORTED_FACES for the target's kind.
// Each usable face becomes `currentVar.faces(cq.NearestToPointSelector(point))`,
// where `point` is that face's known local center (the same
// `attached_to_face` anchor math a relation would use) mapped into
// `targetId`'s current world position -- real-kernel-verified to reliably
// identify exactly one face, including for a rotated target, matching
// brepjs's own `faceFinder().atDistance(0, point)` technique exactly.
function buildShellFacesExpr(
  featureId: string,
  targetId: string,
  kind: string,
  dims: any,
  openFaces: string[],
  currentVar: string,
  worldPointForGroupInstance: (id: string, p: Vec3, groupOffset: Vec3) => Vec3,
  warnings: string[],
): string | null {
  const supported = SHELL_SUPPORTED_FACES[kind];
  if (!supported) {
    warnings.push(
      `feature ${featureId} (shell) targets component ${targetId} (kind "${kind}"), which the composable_part CadQuery generator does not support shelling for; the shell was not applied`,
    );
    return null;
  }
  const usable = openFaces.filter((f) => supported.has(f));
  const dropped = openFaces.filter((f) => !supported.has(f));
  if (dropped.length)
    warnings.push(
      `feature ${featureId} (shell) on component ${targetId} (kind ${kind}) does not reliably support openFaces [${dropped.join(", ")}]; those were dropped from the shell`,
    );
  if (usable.length === 0) {
    warnings.push(
      `feature ${featureId} (shell) has no usable openFaces left after filtering unsupported faces; the shell was not applied`,
    );
    return null;
  }
  const faceExprs = usable.map((faceName) => {
    const localPt = localAnchor("attached_to_face", faceName, kind, dims);
    const worldPt = worldPointForGroupInstance(targetId, localPt, ZERO);
    return `      ${currentVar}.faces(cq.NearestToPointSelector(${pt3(worldPt[0], worldPt[1], worldPt[2])})),`;
  });
  return `[\n${faceExprs.join("\n")}\n    ]`;
}

// Edge selectors reliably usable per target kind for a bounded fillet/
// chamfer feature -- identical support matrix to brepjs.composable.ts's
// FILLET_SUPPORTED_EDGES, for the same real-kernel-established reasons.
const FILLET_SUPPORTED_EDGES: Record<string, Set<string>> = {
  box: new Set(["vertical", "top", "bottom", "all"]),
  plate: new Set(["vertical", "top", "bottom", "all"]),
  tab: new Set(["vertical", "top", "bottom", "all"]),
  rounded_box: new Set(["vertical", "top", "bottom"]),
  cylinder: new Set(["top", "bottom"]),
  boss: new Set(["top", "bottom"]),
  extruded_profile: new Set(["vertical"]),
};

// Builds the Python expression for a bounded fillet/chamfer feature's
// edge list, restricted to FILLET_SUPPORTED_EDGES for the target's kind.
// For "vertical", `cq.ParallelDirSelector(cq.Vector(x, y, z))` -- where
// `(x, y, z)` is the target's own local Z axis rotated into world space --
// real-kernel-verified to correctly select only the vertical edges even for
// a rotated target, matching brepjs's own `.inDirection()` finding exactly
// (a bare Z-axis selector would be wrong for a rotated target). For "all",
// `currentVar.edges()` with no selector returns every edge, real-kernel-
// verified to need no per-instance replication for a patterned/compound
// target either, matching brepjs's `edgeFinder().findAll()` finding. For
// "top"/"bottom", the face is found the same way buildShellFacesExpr()
// does, then `.Edges()` gets its boundary edges; replicated across every
// pattern instance and concatenated into one list, matching brepjs's own
// spread-and-combine technique for a patterned target.
function buildBoundedEdgesExpr(
  featureKind: string,
  featureId: string,
  targetId: string,
  kind: string,
  dims: any,
  edgesSelector: string,
  currentVar: string,
  worldRotatePoint: (id: string, v: Vec3) => Vec3,
  worldPointForGroupInstance: (
    id: string,
    p: Vec3,
    groupOffset: Vec3,
    ownPatternOffset?: Vec3,
  ) => Vec3,
  instanceOffsets: { own: Vec3[]; group: Vec3[] },
  warnings: string[],
): string | null {
  const supported = FILLET_SUPPORTED_EDGES[kind];
  if (!supported?.has(edgesSelector)) {
    warnings.push(
      `feature ${featureId} (${featureKind}) targets component ${targetId} (kind "${kind}"), which does not support edges "${edgesSelector}" in the composable_part CadQuery generator; the ${featureKind} was not applied`,
    );
    return null;
  }
  if (edgesSelector === "vertical") {
    const dir = worldRotatePoint(targetId, [0, 0, 1]);
    return `list(${currentVar}.edges(cq.ParallelDirSelector(cq.Vector${pt3(dir[0], dir[1], dir[2])})))`;
  }
  if (edgesSelector === "all") {
    return `list(${currentVar}.edges())`;
  }
  const localPt = localAnchor("attached_to_face", edgesSelector, kind, dims);
  const edgeLists: string[] = [];
  for (const ownOffset of instanceOffsets.own) {
    for (const groupOffset of instanceOffsets.group) {
      const worldPt = worldPointForGroupInstance(
        targetId,
        localPt,
        groupOffset,
        ownOffset,
      );
      edgeLists.push(
        `list(${currentVar}.faces(cq.NearestToPointSelector(${pt3(worldPt[0], worldPt[1], worldPt[2])})).Edges())`,
      );
    }
  }
  return edgeLists.join(" + ");
}

export type ComposablePartResult = {
  supported: boolean;
  code: string;
  message?: string;
  warnings: string[];
};

export type ComposablePartGenerateOptions = {
  // Same semantics as brepjs's own ComposablePartGenerateOptions -- see
  // brepjs.composable.ts. Must name a component id, a feature id whose kind
  // has a standalone shape of its own (hole/slot/counterbore/countersink --
  // not thread/text, unsupported by this generator, or shell/fillet/
  // chamfer, which modify their target's shape in place), or a group id.
  isolate?: string;
};

export function generateComposablePartCadQuery(
  part: any,
  options?: ComposablePartGenerateOptions,
): ComposablePartResult {
  const warnings: string[] = [];
  const components: any[] = part.components ?? [];
  const features: any[] = part.features ?? [];
  const groups: any[] = part.groups ?? [];

  const nodesById = new Map<string, any>();
  for (const c of components) nodesById.set(c.id, c);
  for (const f of features) nodesById.set(f.id, f);
  for (const g of groups) nodesById.set(g.id, g);
  const featureIdSet = new Set(features.map((f) => f.id));
  const componentsById = new Map(components.map((c) => [c.id, c]));
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const featuresById = new Map(features.map((f) => [f.id, f]));
  const dimsOf = (id: string) => {
    const c = componentsById.get(id);
    return c ? { kind: c.kind, dims: c.dimensions } : null;
  };
  function resolveFeatureCsgTargets(targetId: string): string[] {
    if (componentsById.has(targetId)) return [targetId];
    const group = groupsById.get(targetId);
    if (group) return group.memberIds ?? [];
    const targetFeature = featuresById.get(targetId);
    return targetFeature?.target
      ? resolveFeatureCsgTargets(targetFeature.target)
      : [];
  }
  const transformingGroupOf = new Map<string, string>();
  for (const g of groups)
    if (
      g.position != null ||
      g.rotation != null ||
      g.relation != null ||
      g.pattern != null
    )
      for (const memberId of g.memberIds ?? [])
        transformingGroupOf.set(memberId, g.id);

  const targetHasMultipleInstances = (targetId: string): boolean => {
    const gid = transformingGroupOf.get(targetId);
    return !!(
      componentsById.get(targetId)?.pattern ||
      (gid && groupsById.get(gid)?.pattern)
    );
  };

  const targetPatternInstanceOffsets = (
    targetId: string,
  ): { own: Vec3[]; group: Vec3[] } => {
    const own = patternOffsets(componentsById.get(targetId)?.pattern);
    const gid = transformingGroupOf.get(targetId);
    const group = gid ? patternOffsets(groupsById.get(gid)?.pattern) : [ZERO];
    return { own, group };
  };

  const { resolveOwn, worldPointForGroupInstance, worldRotatePoint } =
    buildResolver(
      nodesById,
      (id) => featureIdSet.has(id),
      dimsOf,
      transformingGroupOf,
    );

  const connectivityWarning = checkAssemblyConnectivity(
    components,
    worldPointForGroupInstance,
    transformingGroupOf,
    groupsById,
  );
  if (connectivityWarning) warnings.push(connectivityWarning);

  warnings.push(
    ...checkClearanceConstraints(
      part.constraints ?? [],
      componentsById,
      transformingGroupOf,
      groupsById,
      worldPointForGroupInstance,
      n,
    ),
  );

  function applyInheritedRotation(expr: string, targetId: string): string {
    let out = applyTransform(expr, resolveOwn(targetId).rotation, ZERO);
    const gid = transformingGroupOf.get(targetId);
    if (gid) out = applyTransform(out, resolveOwn(gid).rotation, ZERO);
    const targetNode = nodesById.get(targetId);
    const targetRel = targetNode
      ? effectiveRelation(targetNode, featureIdSet.has(targetId))
      : undefined;
    if (targetRel?.inheritRotation)
      out = applyInheritedRotation(out, targetRel.target);
    return out;
  }

  function placedComponentExpr(c: any): string {
    const local = buildPatternedGeometry(c.kind, c.dimensions, c.pattern);
    const own = resolveOwn(c.id);
    let oriented = applyTransform(local, own.rotation, ZERO);
    const rel = effectiveRelation(c, false);
    if (rel?.inheritRotation)
      oriented = applyInheritedRotation(oriented, rel.target);
    const placed = applyTransform(oriented, ZERO, own.position);
    const gid = transformingGroupOf.get(c.id);
    if (!gid) return placed;
    const g = resolveOwn(gid);
    const groupOffsets = patternOffsets(groupsById.get(gid)?.pattern);
    if (groupOffsets.length <= 1)
      return applyTransform(placed, g.rotation, g.position);
    const instanceAt = (o: Vec3) =>
      applyTransform(applyTransform(placed, ZERO, o), g.rotation, g.position);
    let combined = instanceAt(groupOffsets[0]);
    for (const o of groupOffsets.slice(1))
      combined = `${combined}.fuse(${instanceAt(o)})`;
    return combined;
  }

  const lines: string[] = [];
  let varCounter = 0;
  function assign(prefix: string, expr: string): string {
    const name = `${prefix}_${varCounter++}`;
    lines.push(`${name} = ${expr}`);
    return name;
  }

  const indexById = new Map<string, number>();
  components.forEach((c, i) => indexById.set(c.id, i));
  const addOrder: string[] = [];
  const shapesById = new Map<string, string>();
  const featureShapesById = new Map<string, string>();

  for (const c of components) {
    if (c.operation !== "add") continue;
    const varName = assign(`comp_${c.id}`, placedComponentExpr(c));
    shapesById.set(c.id, varName);
    addOrder.push(c.id);
  }
  for (const c of components) {
    if (c.operation !== "subtract" && c.operation !== "intersect") continue;
    const thisIndex = indexById.get(c.id)!;
    const targets: string[] =
      c.appliesTo ?? addOrder.filter((id) => indexById.get(id)! < thisIndex);
    const liveTargets = targets.filter((id) => shapesById.has(id));
    const method = c.operation === "subtract" ? "cut" : "intersect";
    if (liveTargets.length === 0) {
      warnings.push(
        `component ${c.id} (${c.operation}) does not apply to any "add" component; the ${method === "cut" ? "cut" : "intersection"} was not applied`,
      );
      continue;
    }
    const operandVar = assign(`${method}_${c.id}`, placedComponentExpr(c));
    for (const targetId of liveTargets) {
      const current = shapesById.get(targetId)!;
      const newVar = assign(
        `comp_${targetId}_${method}`,
        `${current}.${method}(${operandVar})`,
      );
      shapesById.set(targetId, newVar);
    }
  }

  function findTargetPatternGroup(
    node: any,
    isFeature: boolean,
    depth = 0,
  ): any | undefined {
    if (depth > components.length + features.length + groups.length)
      return undefined;
    const rel = effectiveRelation(node, isFeature);
    if (!rel) return undefined;
    const asGroup = groupsById.get(rel.target);
    if (asGroup?.pattern) return asGroup;
    const gid = transformingGroupOf.get(rel.target);
    if (gid) return groupsById.get(gid);
    if (featureIdSet.has(rel.target)) {
      const targetFeature = nodesById.get(rel.target);
      if (targetFeature)
        return findTargetPatternGroup(targetFeature, true, depth + 1);
    }
    return undefined;
  }

  for (const f of features) {
    if (f.kind === "shell") {
      const targets = f.target ? resolveFeatureCsgTargets(f.target) : [];
      const liveTargets = targets.filter((id) => shapesById.has(id));
      if (liveTargets.length === 0) {
        warnings.push(
          `feature ${f.id}'s target does not resolve to any "add" component; the shell was not applied`,
        );
        continue;
      }
      const params = f.parameters ?? {};
      const openFaces: string[] = params.openFaces ?? [];
      for (const targetId of liveTargets) {
        const info = dimsOf(targetId);
        if (!info) continue;
        if (targetHasMultipleInstances(targetId)) {
          warnings.push(
            `feature ${f.id} (shell) targets component ${targetId}, which has multiple pattern instances fused into a single shape; shelling a multi-instance shape is not supported by the underlying kernel and was skipped`,
          );
          continue;
        }
        const current = shapesById.get(targetId)!;
        // NearestToPointSelector needs the shape to search on its own line,
        // so bind a stable, readable alias for it first and pass its real
        // (counter-suffixed) name to buildShellFacesExpr, rather than
        // guessing the name from targetId alone.
        const shapeVar = assign(`${targetId}_shape`, current);
        const facesExpr = buildShellFacesExpr(
          f.id,
          targetId,
          info.kind,
          info.dims,
          openFaces,
          shapeVar,
          worldPointForGroupInstance,
          warnings,
        );
        if (!facesExpr) continue;
        const newVar = assign(
          `comp_${targetId}_shell`,
          `${shapeVar}.hollow(${facesExpr}, ${n(-params.thickness)})`,
        );
        shapesById.set(targetId, newVar);
      }
      continue;
    }
    if (f.kind === "fillet" || f.kind === "chamfer") {
      const targets = f.target ? resolveFeatureCsgTargets(f.target) : [];
      const liveTargets = targets.filter((id) => shapesById.has(id));
      if (liveTargets.length === 0) {
        warnings.push(
          `feature ${f.id}'s target does not resolve to any "add" component; the ${f.kind} was not applied`,
        );
        continue;
      }
      const params = f.parameters ?? {};
      const amount = f.kind === "fillet" ? params.radius : params.distance;
      for (const targetId of liveTargets) {
        const info = dimsOf(targetId);
        if (!info) continue;
        const current = shapesById.get(targetId)!;
        const shapeVar = assign(`${targetId}_shape`, current);
        const edgesExpr = buildBoundedEdgesExpr(
          f.kind,
          f.id,
          targetId,
          info.kind,
          info.dims,
          params.edges,
          shapeVar,
          worldRotatePoint,
          worldPointForGroupInstance,
          targetPatternInstanceOffsets(targetId),
          warnings,
        );
        if (!edgesExpr) continue;
        const call =
          f.kind === "fillet"
            ? `${shapeVar}.fillet(${n(amount)}, ${edgesExpr})`
            : `${shapeVar}.chamfer(${n(amount)}, None, ${edgesExpr})`;
        const newVar = assign(`comp_${targetId}_${f.kind}`, call);
        shapesById.set(targetId, newVar);
      }
      continue;
    }
    const cutExpr = buildFeatureCut(f, warnings);
    if (!cutExpr) continue;
    const targets = f.target ? resolveFeatureCsgTargets(f.target) : [];
    const liveTargets = targets.filter((id) => shapesById.has(id));
    if (liveTargets.length === 0) {
      warnings.push(
        `feature ${f.id}'s target does not resolve to any "add" component; the cut was not applied`,
      );
      continue;
    }
    const explicitTargetInstance =
      effectiveRelation(f, true)?.targetInstance != null;
    if (
      f.target &&
      !f.pattern &&
      !explicitTargetInstance &&
      !groupsById.has(f.target) &&
      nodesById.get(f.target)?.pattern
    ) {
      warnings.push(
        `feature ${f.id} targets ${f.target}, which has its own pattern, but ${f.id} has no pattern of its own; ${f.id} is only applied once, at ${f.target}'s pattern center, not once per instance -- give ${f.id} the same pattern to stack it on every instance`,
      );
    }
    const own = resolveOwn(f.id);
    let patternedCutExpr = buildPatternedCutExpr(cutExpr, f.pattern);
    const rel = effectiveRelation(f, true);
    if (rel?.inheritRotation)
      patternedCutExpr = applyInheritedRotation(patternedCutExpr, rel.target);

    const targetPatternGroup = findTargetPatternGroup(f, true);
    const groupOffsets = patternOffsets(targetPatternGroup?.pattern);
    let placedCut: string;
    if (groupOffsets.length <= 1) {
      placedCut = applyTransform(patternedCutExpr, ZERO, own.position);
    } else {
      const groupRotation = resolveOwn(targetPatternGroup.id).rotation;
      const instanceAt = (o: Vec3) =>
        applyTransform(
          patternedCutExpr,
          ZERO,
          addV(own.position, rotateExtrinsic(o, groupRotation)),
        );
      let combined = instanceAt(groupOffsets[0]);
      for (const o of groupOffsets.slice(1))
        combined = `${combined}.fuse(${instanceAt(o)})`;
      placedCut = combined;
    }

    const cutVar = assign(`featureCut_${f.id}`, placedCut);
    featureShapesById.set(f.id, cutVar);
    for (const targetId of liveTargets) {
      const current = shapesById.get(targetId)!;
      const newVar = assign(
        `comp_${targetId}_cut`,
        `${current}.cut(${cutVar})`,
      );
      shapesById.set(targetId, newVar);
    }
  }

  if (shapesById.size === 0)
    return {
      supported: false,
      code: "",
      message: 'composable_part must have at least one "add" component',
      warnings,
    };

  const header = `# Generated by printspec 0.2.0\n# Review generated CAD before manufacturing.\n# composable_part: geometry is approximate where noted below; review before manufacturing.\nimport cadquery as cq\n\n`;
  const finish = (exportExpr: string): ComposablePartResult => {
    const body = lines.join("\n");
    const code = `${header}${body}\n\npart = ${exportExpr}\n`;
    return { supported: true, code, warnings };
  };

  if (options?.isolate != null) {
    let isolateVar =
      shapesById.get(options.isolate) ?? featureShapesById.get(options.isolate);
    if (isolateVar == null) {
      const group = groupsById.get(options.isolate);
      const liveMemberVars = (group?.memberIds ?? [])
        .map((id: string) => shapesById.get(id))
        .filter((v: string | undefined): v is string => v != null);
      if (liveMemberVars.length > 0)
        isolateVar = liveMemberVars.reduce(
          (acc: string, v: string) => `${acc}.fuse(${v})`,
        );
    }
    if (isolateVar == null)
      return {
        supported: false,
        code: "",
        message:
          `isolate: no component, feature, or group with a standalone shape found for id "${options.isolate}" ` +
          `(shell/fillet/chamfer features modify their target's shape in place and have no shape of their own to isolate)`,
        warnings,
      };
    return finish(isolateVar);
  }

  let partVar = [...shapesById.values()][0];
  for (const v of [...shapesById.values()].slice(1))
    partVar = assign("part", `${partVar}.fuse(${v})`);
  if (shapesById.size === 1) {
    const finalName = "part_0";
    lines.push(`${finalName} = ${partVar}`);
    partVar = finalName;
  }
  return finish(partVar);
}
