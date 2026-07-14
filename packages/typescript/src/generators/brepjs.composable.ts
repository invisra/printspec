// composable_part -> brepjs generator.
//
// Design: all positions/rotations/pattern instances/group composition are
// resolved to literal numbers at generation time (in this file), matching
// the philosophy of every other generator in this package (emit concrete
// numbers, not an abstract resolver, so generated code is easy to review).
// The one exception is rotation composition for a *component's own emitted
// geometry* when it's both individually rotated and a member of a rotating
// group: rather than pre-flattening that into one Euler triple (which isn't
// generally valid for arbitrary axis combinations), we emit two separate,
// sequential .rotate()/.translate() calls and let brepjs's real rotation
// math compose them correctly at the generated code's runtime. See
// applyTransform() and placedComponentExpr(). Anchor-offset rotation
// (rotating a relation's local anchor point, like on_top_of's [0,0,z], by a
// grouped+rotated target's effective orientation) doesn't have this
// restriction, since it only needs to rotate a specific known point rather
// than produce a reusable Euler triple -- see worldRotatePoint() below,
// which composes own-then-group rotation as two sequential numeric
// rotations at generation time.
//
// Every feature kind the schema defines is implemented as of this version.
// `shell`, `fillet`, and `chamfer` (as whole-target features, not
// `rounded_box`'s own built-in corner rounding) all modify a specific
// target's shape in place after CSG,
// which used to be assumed impossible for edges (fillet/chamfer) since
// boolean fusion loses the ability to reference a specific original
// component's edges by identity. `shell` breaks that assumption for faces:
// a target's face can be identified robustly after CSG by a single point
// at zero `atDistance()` from that face's known local center (reusing
// localAnchor()'s attached_to_face math), with no dependency on fusion
// having preserved anything. `fillet`/`chamfer` reuse the same face
// identification plus brepjs's `edgesOfFace()` to get that face's boundary
// edges (for a "top"/"bottom" edge selector), or a world-rotated local Z
// direction vector (for "vertical") -- see buildBoundedEdgesExpr() and
// FILLET_SUPPORTED_EDGES for exactly which (kind, edges) combinations that
// was real-kernel-verified to work for, and buildShellFacesExpr()/
// SHELL_SUPPORTED_FACES for the analogous shell(kind, face) matrix --
// several combinations that seem like they should work don't, for kernel
// reasons external to this generator (see those comments).
//
// `text` (emboss/engrave) is architecturally unlike every other feature:
// it's positioned via the ordinary relation/position pipeline shared with
// hole/slot (no bespoke face/edge lookup needed -- a text feature works
// against any target kind, including rib/wedge), but its content depends on
// a font that brepjs does not bundle -- `loadFont()` fetches an actual font
// file at runtime, and real-kernel testing confirmed Node's built-in
// `fetch()` cannot resolve a local `file://` path (it errors outright), so
// `parameters.fontUrl` must be a real `http(s)://` URL or a `data:` URI
// with the font bytes inlined; there is no offline-safe default this
// generator can fall back to, which is why `fontUrl` is schema-required
// rather than optional. Every unique fontUrl across a spec's text features
// is loaded exactly once via a top-level `await loadFont(url, "font_N")`
// statement emitted before any other geometry-building code, regardless of
// where in `features` the text feature(s) using it are declared -- top-
// level `await` is valid at an ES module's top level and real-kernel/
// runtime-verified to correctly delay a plain dynamic `import()` of the
// generated module until it resolves, so `export default () => shape`
// stays a synchronous factory with no calling-convention change for
// consumers. `sketchText(content, {...}).extrude(depth)` returns a raw
// shape directly (unlike the free `extrude()` function used by rib/wedge/
// extruded_profile, which returns a Result needing `unwrap()`) -- real-
// kernel-verified. "emboss" (the default) fuses that extrusion onto the
// target instead of cutting, unlike every other feature kind (except a
// "thread" feature in its own "external" mode) -- see featureAddsMaterial()
// and its call site in the main features loop. Both
// modes extrude 0.2mm taller than requested and shift the result so it
// genuinely overlaps the target's surface, not just touches it -- the same
// generous-overlap idea already used by counterbore/countersink/hole/slot's
// oversized cutters, extended to fuse (not just cut): real-kernel testing
// found a flush-touching (zero-overlap) emboss fuse left multi-glyph text
// as invalid geometry outright, not merely an unmerged-but-valid compound.
// See textCutExpr() and TEXT_OVERLAP_MARGIN for both modes' exact numbers.
//
// `rib` and `wedge` are both built as real tapered profiles via wireLoop/line/face/extrude
// (a right-triangular gusset and a sloped ramp, respectively); neither has
// a clean AABB footprint/depth split the way a box or cylinder does,
// consistent with both already being excluded from bounds-checking for
// that reason. `extruded_profile` generalizes the same wireLoop/line/face/
// extrude technique to an arbitrary author-supplied polygon, and *does*
// have a clean (derived) AABB, since its footprint's bounding box is
// well-defined -- see pointsBoundingBox() and aabbExtents() below.

import { brepjsNumber as n } from "./brepjs.core.js";
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

// Builds the list of edge expressions for a closed profile loop
// (extruded_profile's XY footprint or revolved_profile's (radius, z)
// half-plane), honoring each vertex's optional `curve` -- an arc through a
// given point (brepjs's threePointArc(start, through, end), real-kernel-
// verified to bulge through exactly the given point), a Bezier through one
// or more control points (brepjs's bezier([start, ...controls, end]),
// real-kernel-verified against the quadratic-Bezier area-vs-chord formula),
// or a smooth B-spline through one or more points (brepjs's
// bsplineApprox([start, ...through, end]), real-kernel-verified to
// genuinely curve through the given points rather than degenerating to a
// straight line -- confirmed with an asymmetric point set whose bulge would
// be unmistakable in the resulting volume) -- instead of always connecting
// consecutive vertices with a straight line. `shift` maps a raw authored
// point to its shifted, formatted [a, b] pair (centered XY for
// extruded_profile, Z-shifted for revolved_profile -- whatever convention
// the caller already uses for its main vertices, so curve sub-points are
// shifted exactly the same way); `toPoint3` wraps a shifted pair into the
// 3D point string line()/threePointArc()/bezier()/bsplineApprox() expect
// (for example `[x, y, 0]` or `[r, 0, z]`).
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
      return `  threePointArc(${from}, ${through}, ${to}),`;
    }
    if (curve?.type === "bezier") {
      const ctrl = curve.controlPoints.map((p: any) => toPoint3(shift(p)));
      return `  unwrap(bezier([${from}, ${ctrl.join(", ")}, ${to}])),`;
    }
    if (curve?.type === "spline") {
      const through = curve.through.map((p: any) => toPoint3(shift(p)));
      return `  unwrap(bsplineApprox([${from}, ${through.join(", ")}, ${to}])),`;
    }
    return `  line(${from}, ${to}),`;
  });
}

// Wraps a brepjs shape expression with rotate/translate calls for a
// resolved transform, skipping any axis/translation that's exactly zero to
// keep generated code readable. Rotation is emitted as three separate
// world-axis .rotate() calls (X, then Y, then Z) rather than one combined
// call, since that's the only rotation composition brepjs's fluent API
// documents, and it matches the extrinsic X-then-Y-then-Z point math used
// for anchor resolution above.
function applyTransform(expr: string, rotation: Vec3, position: Vec3): string {
  let out = expr;
  const axes: Array<[number, string]> = [
    [rotation[0], "[1, 0, 0]"],
    [rotation[1], "[0, 1, 0]"],
    [rotation[2], "[0, 0, 1]"],
  ];
  for (const [deg, axis] of axes)
    if (deg !== 0) out = `shape(${out}).rotate(${n(deg)}, { axis: ${axis} }).val`;
  if (position[0] !== 0 || position[1] !== 0 || position[2] !== 0)
    out = `shape(${out}).translate([${n(position[0])}, ${n(position[1])}, ${n(position[2])}]).val`;
  return out;
}

// Builds a single component instance's local geometry (before its own
// rotation/position/group transform is applied). See the module doc for
// the rib/wedge approximation notes.
function buildComponentGeometry(kind: string, dims: any): string {
  const centeredBox = (l: unknown, w: unknown, h: unknown) =>
    `shape(box(${n(l)}, ${n(w)}, ${n(h)})).translate([${n(-Number(l) / 2)}, ${n(-Number(w) / 2)}, 0]).val`;
  switch (kind) {
    case "box":
      return centeredBox(dims.length, dims.width, dims.height);
    case "rounded_box": {
      const base = centeredBox(dims.length, dims.width, dims.height);
      if (!(dims.radius > 0)) return base;
      return `shape(${base}).fillet((e) => e.inDirection('Z'), ${n(dims.radius)}).val`;
    }
    case "cylinder":
    case "boss":
      return `cylinder(${n(dims.diameter / 2)}, ${n(dims.height)})`;
    case "tube": {
      const outer = `cylinder(${n(dims.outerDiameter / 2)}, ${n(dims.height)})`;
      const inner = `shape(cylinder(${n(dims.innerDiameter / 2)}, ${n(dims.height)} + 0.2)).translate([0, 0, -0.1]).val`;
      return `shape(${outer}).cut(${inner}).val`;
    }
    case "plate":
    case "tab":
      return centeredBox(dims.length, dims.width, dims.thickness);
    case "rib": {
      // A right-triangle gusset profile in the XZ plane at y0 =
      // -thickness/2, extruded along +Y by `thickness` -- full height at
      // the wall end (x0), tapering to zero at the far end (x1), the
      // classic structural-reinforcement shape. Identical technique to
      // `wedge` below (thickness stands in for wedge's width); see its
      // comment for why extrude() needs an explicit direction vector here.
      const t = n(dims.thickness);
      const h = n(dims.height);
      const x0 = n(-dims.length / 2);
      const x1 = n(dims.length / 2);
      const y0 = n(-dims.thickness / 2);
      return (
        `unwrap(extrude(unwrap(face(unwrap(wireLoop([\n` +
        `  line([${x0}, ${y0}, 0], [${x1}, ${y0}, 0]),\n` +
        `  line([${x1}, ${y0}, 0], [${x0}, ${y0}, ${h}]),\n` +
        `  line([${x0}, ${y0}, ${h}], [${x0}, ${y0}, 0]),\n` +
        `])))), [0, ${t}, 0]))`
      );
    }
    case "wedge": {
      // A right-triangle profile in the XZ plane at y0 = -width/2, extruded
      // along +Y by `width`. extrude(face, height) extrudes along Z when
      // given a plain number -- degenerate here, since the profile already
      // lies in the XZ plane -- so the distance must be passed as an
      // explicit [0, width, 0] direction vector instead.
      const w = n(dims.width);
      const h = n(dims.height);
      const x0 = n(-dims.length / 2);
      const x1 = n(dims.length / 2);
      const y0 = n(-dims.width / 2);
      return (
        `unwrap(extrude(unwrap(face(unwrap(wireLoop([\n` +
        `  line([${x0}, ${y0}, 0], [${x1}, ${y0}, 0]),\n` +
        `  line([${x1}, ${y0}, 0], [${x0}, ${y0}, ${h}]),\n` +
        `  line([${x0}, ${y0}, ${h}], [${x0}, ${y0}, 0]),\n` +
        `])))), [0, ${w}, 0]))`
      );
    }
    case "extruded_profile": {
      // An arbitrary polygon footprint in the XY plane at Z=0, extruded
      // along +Z by `height`. Unlike wedge/rib (whose profile lies *in* the
      // XZ or similar vertical plane), this profile already lies in the XY
      // plane, so extrude(face, height) with a plain number is correct as
      // given -- it extrudes along Z, which is exactly the direction
      // wanted here (contrast with wedge/rib's comment on the same
      // function). Real-kernel-verified that winding direction (the order
      // `points` happens to be listed in) doesn't matter -- both windings
      // produce the same correct, positive-volume solid, for convex and
      // concave polygons alike -- so points are emitted in author order
      // with no normalization. The bounding box is centered at the
      // component's local origin, the same convention as every other kind
      // (see pointsBoundingBox(), shared with aabbExtents() so relation
      // anchors agree with the actual geometry). Each vertex's optional
      // `curve` (an arc or Bezier segment to the next vertex, instead of a
      // straight line) is handled by the shared buildProfileEdges() -- see
      // its own comment for the real-kernel verification behind both.
      const { minX, maxX, minY, maxY } = pointsBoundingBox(dims.points);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const shift = (p: { x: number; y: number }): [string, string] => [n(p.x - cx), n(p.y - cy)];
      const lines = buildProfileEdges(dims.points, shift, ([x, y]) => `[${x}, ${y}, 0]`);
      return (
        `unwrap(extrude(unwrap(face(unwrap(wireLoop([\n` +
        `${lines.join("\n")}\n` +
        `])))), ${n(dims.height)}))`
      );
    }
    case "sphere":
      // brepjs's sphere() is centered at its own origin by default (unlike
      // box/cylinder, whose native default already has Z=0 at the base) --
      // shift it up by its own radius so its base, not its center, sits at
      // Z=0, the same "Z=0 at base, extending in +Z" convention every other
      // kind already follows.
      return `shape(sphere(${n(dims.diameter / 2)})).translate([0, 0, ${n(dims.diameter / 2)}]).val`;
    case "torus": {
      // brepjs's torus() takes (majorRadius, minorRadius) and, like sphere(),
      // centers at its own origin by default with its axis along Z (so it
      // lies flat, the tube sweeping a circle in the XY plane) -- shift it
      // up by the minor radius (half the tube's own cross-sectional
      // diameter) so its base, not its center, sits at Z=0. majorRadius is
      // derived from the author-facing outerDiameter/tubeDiameter (the
      // measurements one would actually take of a real ring) rather than
      // asking the author to compute a major radius themselves; semantic
      // validation (componentDimensionErrors()) already guarantees
      // tubeDiameter < outerDiameter, so majorRadius is always positive.
      const minorRadius = dims.tubeDiameter / 2;
      const majorRadius = (dims.outerDiameter - dims.tubeDiameter) / 2;
      return `shape(torus(${n(majorRadius)}, ${n(minorRadius)})).translate([0, 0, ${n(minorRadius)}]).val`;
    }
    case "ellipsoid":
      // brepjs's ellipsoid() takes half-lengths (rx, ry, rz) and, like
      // sphere()/torus(), centers at its own origin by default -- shift up
      // by its own Z half-length so its base sits at Z=0.
      return `shape(ellipsoid(${n(dims.lengthX / 2)}, ${n(dims.lengthY / 2)}, ${n(dims.lengthZ / 2)})).translate([0, 0, ${n(dims.lengthZ / 2)}]).val`;
    case "revolved_profile": {
      // An arbitrary polygon cross-section in the (radius, z) half-plane
      // (X=radius, Y=0), revolved around Z via brepjs's real revolve()
      // operation -- real-kernel-verified for both a full 360-degree sweep
      // (matching a hand-derived conical-frustum volume exactly) and a
      // partial sweep (correctly capped with flat faces at each end,
      // producing exactly the expected fraction of the full-sweep volume).
      // Unlike extruded_profile's XY footprint (centered at the component's
      // local origin, since it has no privileged reference point), radius
      // is never shifted or centered here -- the revolve axis (radius=0) is
      // a fixed reference the whole profile is authored against, not an
      // arbitrary footprint. Z is shifted so the profile's own minimum
      // lands at 0, the same "Z=0 at base" convention as every other kind.
      // sweepAngle (degrees, author-facing) converts to the radians
      // revolve() expects; omitted entirely for a full 360-degree sweep
      // (brepjs's own default) to keep generated code readable, matching
      // applyTransform()'s skip-the-default-case convention elsewhere.
      // Each vertex's optional `curve` is handled by the shared
      // buildProfileEdges() -- see its own comment for the real-kernel
      // verification behind both the arc and Bezier cases.
      const { minZ } = revolveProfileExtents(dims.points);
      const shift = (p: { radius: number; z: number }): [string, string] => [
        n(p.radius),
        n(p.z - minZ),
      ];
      const lines = buildProfileEdges(dims.points, shift, ([r, z]) => `[${r}, 0, ${z}]`);
      const sweepAngle = dims.sweepAngle ?? 360;
      const options = sweepAngle === 360 ? "" : `, { angle: ${n((sweepAngle * Math.PI) / 180)} }`;
      return (
        `unwrap(revolve(unwrap(face(unwrap(wireLoop([\n` +
        `${lines.join("\n")}\n` +
        `]))))${options}))`
      );
    }
    case "loft_profile": {
      // Blends between 2+ cross-sectional profiles via brepjs's real
      // loft(wires) operation -- real-kernel-verified to return an already-
      // capped, valid solid directly (no separate end-capping needed,
      // unlike some CAD kernels' raw lofted-shell primitives), for matching
      // vertex counts (matching a hand-derived frustum volume exactly),
      // mismatched vertex counts (a square-to-hexagon transition), and 3+
      // stacked profiles (matching a hand-derived symmetric-barrel volume
      // exactly). Each profile is a wire, not a face -- unlike extrude/
      // revolve, loft() doesn't need face() at all. Every profile is
      // centered on its own local origin independently (via its own
      // pointsBoundingBox(), the same per-component convention
      // extruded_profile already uses), so cross-sections stack
      // concentrically by default -- not on one shared, combined bounding
      // box, which could misalign very differently-sized sections. Z is
      // shifted uniformly (by the same amount for every profile) so the
      // lowest profile's z lands at 0, the same "Z=0 at base" convention as
      // every other kind.
      const zs = dims.profiles.map((p: { z: number }) => p.z);
      const minZ = Math.min(...zs);
      const wires = dims.profiles.map((profile: { points: any[]; z: number }) => {
        const { minX, maxX, minY, maxY } = pointsBoundingBox(profile.points);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const shift = (p: { x: number; y: number }): [string, string] => [
          n(p.x - cx),
          n(p.y - cy),
        ];
        const z = n(profile.z - minZ);
        const edges = buildProfileEdges(profile.points, shift, ([x, y]) => `[${x}, ${y}, ${z}]`);
        return `unwrap(wireLoop([\n${edges.join("\n")}\n]))`;
      });
      return `unwrap(loft([\n${wires.map((w: string) => `  ${w},`).join("\n")}\n]))`;
    }
    case "swept_profile": {
      // An arbitrary closed cross-section swept along a straight-line-
      // segment 3D path via brepjs's real sweep(profile, spine, options)
      // operation. Real-kernel testing found brepjs does NOT auto-orient
      // the profile to the spine's own tangent direction -- sweeping a
      // profile authored in the XY plane along a spine whose first segment
      // isn't parallel to Z produced invalid (zero-volume) geometry no
      // matter which sweep option was tried, so the profile's fixed
      // XY-plane orientation requires the path's first segment to run
      // parallel to Z (checked at validation time --
      // componentDimensionErrors()/_component_dimension_errors() in
      // semantic.ts/semantic.py). Unlike extruded_profile, `profile` is NOT
      // centered on its own bounding box: real-kernel testing confirmed the
      // profile's own literal coordinates matter (brepjs does not
      // re-center or snap it to the spine's start), so a profile point at
      // (0, 0) sits exactly on the path's own centerline, authored directly
      // in the path's local frame. `path[0]` becomes the component's own
      // local origin (Z=0), the same base convention as every other kind;
      // every other path point is shifted by the same offset. Every
      // profile vertex's optional `curve` is handled by the shared
      // buildProfileEdges() (same as extruded_profile/revolved_profile);
      // the path itself only supports straight segments for now.
      // `transitionMode: "round"` is always passed -- real-kernel testing
      // found the default (no options) and `"right"` (a sharp miter) both
      // produce invalid geometry at a direction change, while `"round"`
      // produced valid geometry with a plausible volume at a bend, and
      // (confirmed separately) doesn't change a single-segment straight
      // sweep's exact volume either, so it's always safe to pass.
      const p0 = dims.path[0];
      const pathPoints = dims.path.map(
        (p: { x: number; y: number; z: number }) =>
          `[${n(p.x - p0.x)}, ${n(p.y - p0.y)}, ${n(p.z - p0.z)}]`,
      );
      const spineEdges = pathPoints
        .slice(0, -1)
        .map((from: string, i: number) => `  line(${from}, ${pathPoints[i + 1]}),`);
      const profileShift = (p: { x: number; y: number }): [string, string] => [n(p.x), n(p.y)];
      const profileEdges = buildProfileEdges(dims.profile, profileShift, ([x, y]) => `[${x}, ${y}, 0]`);
      return (
        `unwrap(sweep(\n` +
        `  unwrap(wireLoop([\n${profileEdges.join("\n")}\n  ])),\n` +
        `  unwrap(wire([\n${spineEdges.join("\n")}\n  ])),\n` +
        `  { transitionMode: "round" },\n` +
        `))`
      );
    }
    default:
      return `box(1, 1, 1)`;
  }
}

// Builds a component's full local geometry, expanding its pattern (if set)
// into a fused union of instances. All instances share the single
// component's id, per docs/composable-parts.md.
function buildPatternedGeometry(kind: string, dims: any, pattern: any): string {
  const base = buildComponentGeometry(kind, dims);
  const offsets = patternOffsets(pattern);
  if (offsets.length <= 1) return base;
  // .fuse() is documented as a pairwise union; there's no confirmed batch
  // "fuse all" API (unlike .cutAll()), so chain sequential .fuse() calls.
  let combined = `shape(${base}).translate([${n(offsets[0][0])}, ${n(offsets[0][1])}, ${n(offsets[0][2])}]).val`;
  for (const o of offsets.slice(1)) {
    const instance = `shape(${base}).translate([${n(o[0])}, ${n(o[1])}, ${n(o[2])}]).val`;
    combined = `shape(${combined}).fuse(${instance}).val`;
  }
  return combined;
}

// Builds a feature's full local cutter geometry, expanding its pattern (if
// set) into a fused union of cutter instances -- the cutting equivalent of
// buildPatternedGeometry() above, and by the same reasoning (all instances
// share the feature's single id and aren't individually addressable). A
// single .cut() with this combined cutter then removes every instance from
// the target(s) at once.
function buildPatternedCutExpr(cutExpr: string, pattern: any): string {
  const offsets = patternOffsets(pattern);
  if (offsets.length <= 1) return cutExpr;
  let combined = `shape(${cutExpr}).translate([${n(offsets[0][0])}, ${n(offsets[0][1])}, ${n(offsets[0][2])}]).val`;
  for (const o of offsets.slice(1)) {
    const instance = `shape(${cutExpr}).translate([${n(o[0])}, ${n(o[1])}, ${n(o[2])}]).val`;
    combined = `shape(${combined}).fuse(${instance}).val`;
  }
  return combined;
}

// Reorients a Z-axis-built shape to run along x/y instead, using the same
// rotation convention as everywhere else. z is the default/no-op case.
function orientAlongAxis(expr: string, axis: string): string {
  if (axis === "x") return `shape(${expr}).rotate(90, { axis: [0, 1, 0] }).val`;
  if (axis === "y") return `shape(${expr}).rotate(-90, { axis: [1, 0, 0] }).val`;
  return expr;
}

// A hole/slot cut, centered on the feature's resolved position (not
// surface-anchored -- see the module doc). depth is generous when "through"
// is requested, since this generator doesn't trace back to a specific
// surface thickness the way the part-family generators can.
const THROUGH_DEPTH = 1000;
function resolveDepth(depth: unknown): number {
  return depth === "through" || depth == null ? THROUGH_DEPTH : Number(depth);
}
function holeCutExpr(params: any): string {
  const depth = resolveDepth(params.depth);
  const base = `shape(cylinder(${n(params.diameter / 2)}, ${n(depth + 0.2)})).translate([0, 0, ${n(-(depth + 0.2) / 2)}]).val`;
  return orientAlongAxis(base, params.axis ?? "z");
}
function slotCutExpr(params: any): string {
  const depth = resolveDepth(params.depth);
  const base = `shape(box(${n(params.length)}, ${n(params.width)}, ${n(depth + 0.2)})).translate([${n(-params.length / 2)}, ${n(-params.width / 2)}, ${n(-(depth + 0.2) / 2)}]).val`;
  return orientAlongAxis(base, params.axis ?? "z");
}
function counterboreCutExpr(params: any): string {
  return `shape(cylinder(${n(params.diameter / 2)}, ${n(params.depth)})).translate([0, 0, ${n(-params.depth / 2)}]).val`;
}
function countersinkCutExpr(params: any): string {
  const r1 = params.diameter / 2;
  const angleRad = (params.angle * Math.PI) / 180;
  const height = r1 / Math.tan(angleRad / 2);
  return `shape(cone(${n(r1)}, 0.01, ${n(height)})).translate([0, 0, ${n(-height / 2)}]).val`;
}

const DEFAULT_TEXT_SIZE = 10;

// Builds a text feature's local (unplaced) geometry via sketchText+extrude.
// `fontFamily` is the stable `font_N` key this fontUrl was registered under
// (see the `fontFamilyByUrl` loading block above). `sketchText(...).extrude()`
// returns a raw shape directly, unlike the free `extrude()` function used by
// rib/wedge/extruded_profile, which returns a Result -- real-kernel-
// verified, so no unwrap() here. For "emboss" the base of the extrusion
// (Z=0) sits at the feature's resolved position, matching every other
// kind's own-origin convention, and grows in +Z from there (so it sits ON a
// surface the feature is anchored to, e.g. via attached_to_face "top"). For
// "engrave" the same technique already used for counterbore/countersink's
// oversized cutters applies: extrude 0.2mm taller than requested and shift
// the whole solid down by the requested depth, so the cutter straddles the
// anchor point -- poking 0.2mm above it (guaranteeing full penetration
// through the target's outer surface with no float-precision gap) and
// extending exactly `depth` below it (the actual recess depth).
// Both modes extrude TEXT_OVERLAP_MARGIN taller than the requested `depth`
// and then shift the whole solid down by either `depth` (engrave) or just
// the margin (emboss), so the boolean operand always genuinely overlaps the
// target's surface by TEXT_OVERLAP_MARGIN instead of merely touching it at
// a single coincident plane. For "engrave" (a cut) this is the same
// generous-overlap technique already used by counterbore/countersink/hole/
// slot's oversized cutters, guaranteeing full penetration through the
// target's outer surface with no float-precision gap. For "emboss" (a
// fuse) this turned out to matter even more: real-kernel testing found a
// flush-touching (zero-overlap) fuse between a target and a multi-glyph
// text extrusion left the added glyphs as invalid, un-weldable geometry
// ("Solid failed BRepCheck validation") rather than merely an unmerged-but-
// valid compound -- a small embedded root fixes this. Either way the
// *visible* result matches the author's `depth` exactly: an embossed
// glyph's exposed height above the surface is `depth`, and an engraved
// glyph's recess depth into the surface is `depth`; only the margin (which
// ends up either buried in the target or a fraction of a mm above its
// outer surface) is invisible construction slack.
const TEXT_OVERLAP_MARGIN = 0.2;
function textCutExpr(params: any, fontFamily: string): string {
  const size = params.size ?? DEFAULT_TEXT_SIZE;
  const mode = params.mode ?? "emboss";
  const base = `sketchText(${JSON.stringify(params.content)}, { fontSize: ${n(size)}, fontFamily: ${JSON.stringify(fontFamily)} }).extrude(${n(params.depth + TEXT_OVERLAP_MARGIN)})`;
  const zShift = mode === "engrave" ? -params.depth : -TEXT_OVERLAP_MARGIN;
  return `shape(${base}).translate([0, 0, ${n(zShift)}]).val`;
}

// Resolves a thread feature's brepjs `radius` (the root radius `thread()`
// itself expects) directly from its target's own dimensions -- never
// author-specified, so the ridge always sits exactly flush with the surface
// it belongs to (real-kernel-verified: a rod/bore built at exactly the same
// radius as the thread's own `radius` fuses/cuts cleanly with no gap or
// margin trick needed, unlike text's TEXT_OVERLAP_MARGIN). "external" reads
// a cylinder/boss's `diameter` or a tube's `outerDiameter`; "internal" reads
// a tube's own `innerDiameter`, or -- for a feature target -- a stacked
// `hole` feature's own `diameter` (matching how counterbore/countersink
// already stack on a hole). Semantic validation (`threadFeatureErrors()` in
// semantic.ts) already guarantees the target/mode combination is valid, so
// this only returns null for a genuinely missing dimension.
function resolveThreadRadius(
  feature: any,
  componentsById: Map<string, any>,
  featuresById: Map<string, any>,
): number | null {
  const mode = (feature.parameters ?? {}).mode ?? "external";
  const component = componentsById.get(feature.target);
  if (component) {
    const dims = component.dimensions ?? {};
    if (mode === "external") {
      if (component.kind === "cylinder" || component.kind === "boss") return dims.diameter / 2;
      if (component.kind === "tube") return dims.outerDiameter / 2;
      return null;
    }
    if (component.kind === "tube") return dims.innerDiameter / 2;
    return null;
  }
  const targetFeature = featuresById.get(feature.target);
  if (mode === "internal" && targetFeature?.kind === "hole")
    return (targetFeature.parameters ?? {}).diameter / 2;
  return null;
}
// Builds a thread feature's local (unplaced) geometry via brepjs's real
// `thread()` operation -- a helical screw-thread ridge, base at the
// feature's resolved position (Z=0, growing in +Z by `height`), matching
// every other kind's own-origin convention. Real-kernel testing found the
// ridge extends a small amount (a few percent of its own volume) past both
// [0, height] ends -- an inherent characteristic of thread()'s own lofted
// tooth-section construction, not something this generator shifts or trims;
// see docs/composable-parts.md.
function threadCutExpr(params: any, radius: number): string {
  const mode = params.mode ?? "external";
  const opts = [`radius: ${n(radius)}`, `pitch: ${n(params.pitch)}`, `height: ${n(params.height)}`];
  if (params.depth != null) opts.push(`depth: ${n(params.depth)}`);
  if (params.toothHalfWidth != null) opts.push(`toothHalfWidth: ${n(params.toothHalfWidth)}`);
  if (params.crest != null) opts.push(`crest: ${n(params.crest)}`);
  if (params.sectionsPerTurn != null) opts.push(`sectionsPerTurn: ${Math.trunc(params.sectionsPerTurn)}`);
  if (params.lefthand) opts.push(`lefthand: true`);
  if (mode === "internal") opts.push(`inward: true`);
  return `unwrap(thread({ ${opts.join(", ")} }))`;
}

// Builds the cut/add expression for one feature instance, or null for a
// kind that isn't implemented (text without a resolvable fontUrl, thread
// without a resolvable target radius, or `fillet`/`chamfer`'s stray
// no-target case -- see module doc). The caller (the main features loop) is
// responsible for knowing that a "text" feature in "emboss" mode, or a
// "thread" feature in "external" mode, should be fused, not cut, onto its
// target -- see featureAddsMaterial() there.
function buildFeatureCut(
  feature: any,
  warnings: string[],
  fontFamilyByUrl: Map<string, string>,
  componentsById: Map<string, any>,
  featuresById: Map<string, any>,
): string | null {
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
    case "text": {
      const family = fontFamilyByUrl.get(params.fontUrl);
      if (!family) {
        warnings.push(
          `feature ${feature.id} (text) has no resolvable fontUrl; the text was not applied`,
        );
        return null;
      }
      return textCutExpr(params, family);
    }
    case "thread": {
      const radius = resolveThreadRadius(feature, componentsById, featuresById);
      if (radius == null) {
        warnings.push(
          `feature ${feature.id} (thread)'s target has no resolvable radius for its mode; the thread was not applied`,
        );
        return null;
      }
      return threadCutExpr(params, radius);
    }
    default:
      return null;
  }
}
// A "text" feature in "emboss" mode (the default), or a "thread" feature in
// "external" mode (the default), adds material -- it should be fused onto
// its target(s), not cut from them, unlike every other feature kind
// buildFeatureCut() handles.
function featureAddsMaterial(feature: any): boolean {
  if (feature.kind === "text") return (feature.parameters?.mode ?? "emboss") === "emboss";
  if (feature.kind === "thread") return (feature.parameters?.mode ?? "external") === "external";
  return false;
}

// Faces reliably shell-able per target kind, established by real-kernel
// testing (scripts/brepjs-verify), not by inspection -- several plausible
// combinations turned out not to work:
//  - `top`/`bottom` work for every kind below: both are flat caps whose
//    center point (localAnchor's "top"/"bottom" anchor) reliably identifies
//    exactly one face via faceFinder().atDistance(0, point), and shelling
//    with one of them removed always produced the hand-calculated volume.
//  - `front`/`back`/`left`/`right` additionally work for box/plate/tab --
//    flat side walls, same reasoning. They do NOT reliably work for
//    rounded_box: the flat side-wall face is topologically adjacent to the
//    vertical-edge fillets, and real-kernel testing found `.shell()` there
//    completes without error but silently returns a shape with the
//    *original, unshelled* volume -- no cavity actually created. Since this
//    fails silently (no exception to catch and warn on), rounded_box is
//    restricted to top/bottom only, where no fillet adjacency exists.
//  - `side` (the curved lateral face) is excluded for cylinder/boss: real-
//    kernel testing hit a kernel-level `SHELL_FAILED` exception ("Shell
//    operation failed: shellWithHistory: operation failed") removing it,
//    even at generous thickness/radius ratios. This may be a real OCCT
//    limitation shelling adjacent to a curved face, not something this
//    generator can work around by picking a different point.
//  - `tube` and `extruded_profile` are absent entirely: a tube's top/bottom
//    faces are annuli that don't cover the local origin the way every other
//    kind's flat cap does (a hole runs through the middle), so
//    atDistance(0, [0,0,z]) matches zero faces there; extruded_profile's
//    polygon may be concave, and its bounding-box center (the point
//    localAnchor would use) is not guaranteed to lie inside the solid at
//    all -- for an L-shape in particular it commonly lands exactly on the
//    reflex corner, ambiguously on the boundary of three faces at once.
//    Both would need a smarter face-identification strategy than a single
//    fixed point; out of scope for this first version. `rib`/`wedge` have
//    no footprint/depth model to compute a face-center point from in the
//    first place (see aabbExtents()).
const SHELL_SUPPORTED_FACES: Record<string, Set<string>> = {
  box: new Set(["top", "bottom", "front", "back", "left", "right"]),
  plate: new Set(["top", "bottom", "front", "back", "left", "right"]),
  tab: new Set(["top", "bottom", "front", "back", "left", "right"]),
  rounded_box: new Set(["top", "bottom"]),
  cylinder: new Set(["top", "bottom"]),
  boss: new Set(["top", "bottom"]),
};

// Builds the `Face[]` array expression for a shell feature's `openFaces`,
// restricted to SHELL_SUPPORTED_FACES for the target's kind (see its
// comment above). Each usable face becomes `faceFinder().atDistance(0,
// point).findAll(currentVar)`, where `point` is that face's known local
// center (the same `attached_to_face` anchor math a relation would use),
// mapped into `targetId`'s current world position via
// worldPointForGroupInstance() -- a point exactly on a face has distance 0
// from it, and (real-kernel-verified) from no other face, so this reliably
// identifies one face per name without depending on anything fusion or
// prior cuts may have done to face topology. Returns null (with a warning)
// if the target's kind isn't shell-able at all, or if every requested face
// was dropped as unsupported for it.
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
      `feature ${featureId} (shell) targets component ${targetId} (kind "${kind}"), which the composable_part brepjs generator does not support shelling for; the shell was not applied`,
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
    return `...faceFinder().atDistance(0, [${n(worldPt[0])}, ${n(worldPt[1])}, ${n(worldPt[2])}]).findAll(${currentVar})`;
  });
  return `[${faceExprs.join(", ")}]`;
}

// Edge selectors reliably usable per target kind for a bounded fillet/
// chamfer feature, established by real-kernel testing (scripts/brepjs-
// verify):
//  - "vertical" selects edges parallel to the target's own local Z axis,
//    via `.inDirection()` with that axis rotated into world space (see
//    buildBoundedEdgesExpr) -- only meaningful for kinds with straight
//    Z-parallel edges in the first place: box/plate/tab (identical boxy
//    geometry), rounded_box (its vertical seams between flat faces and the
//    corner fillets -- there are no sharp corners left to re-fillet, but
//    those seams are real edges), and extruded_profile (one straight
//    vertical edge per polygon vertex, regardless of convexity/concavity,
//    since "vertical" is a pure direction filter with no dependency on the
//    bounding-box-center-point technique that excludes extruded_profile
//    from top/bottom below). cylinder/boss/tube have no straight edges at
//    all -- real-kernel testing confirmed `.inDirection('Z')` there throws
//    ("There are no suitable edges for chamfer or fillet"), not silently
//    matches nothing, so this is excluded rather than left to fail loudly
//    at generated-code runtime.
//  - "top"/"bottom" reuse exactly SHELL_SUPPORTED_FACES's top/bottom set
//    (box, rounded_box, plate, tab, cylinder, boss) and the same
//    atDistance(0, point)-based face identification, then brepjs's
//    `edgesOfFace()` to get that face's boundary edges -- real-kernel-
//    verified for a plain box (4 edges), a cylinder (1 circular edge), and
//    a rounded_box (8 edges, since filleting the vertical corners first
//    splits each side face's originally-4-edge perimeter at the new
//    flat/curved seams) -- and confirmed rotation-safe, matching the same
//    result as the unrotated case. tube/extruded_profile are excluded for
//    the same face-identification reasons as shell (see
//    SHELL_SUPPORTED_FACES); rib/wedge have no footprint/depth model to
//    derive a face-center point from.
// Unlike shell, a target with multiple pattern instances fused into one
// shape is fully supported: real-kernel testing confirmed .fillet()/
// .chamfer() (unlike .shell()) tolerate a disjoint-solid compound just
// fine, for both "vertical" (automatic -- see buildBoundedEdgesExpr) and
// "top"/"bottom" (via replicating the face lookup across every instance
// and combining into one edges array -- see targetPatternInstanceOffsets()
// and its call site in the main features loop). shell has no equivalent,
// since real-kernel testing found .shell() throws outright on a compound
// regardless of how the faces to remove were identified.
// "all" (every edge on the target, via brepjs's edgeFinder().findAll()) is
// deliberately restricted to box/plate/tab only, not the full "vertical" +
// "top" + "bottom" set: real-kernel testing confirmed it produces an exact,
// hand-verifiable Minkowski-sum-style full 3D round-over for a plain box
// (fillet volume matched a hand-derived formula -- core box plus edge
// quarter-cylinders plus corner octant-spheres -- exactly), but a curved
// kind like cylinder/boss has an extra "seam" edge (edgeFinder found 3
// edges on a plain cylinder, not the 2 circular rims a human would expect)
// that "all" would also try to fillet, with no real-kernel confirmation
// either way of what that produces visually; and rounded_box already bakes
// its own vertical-edge fillet into its own construction (see
// buildComponentGeometry()'s "rounded_box" case), so stacking "all" on top
// risks the same real, documented fillet-after-fillet fragility already
// found for `fillet`+`chamfer` order-sensitivity elsewhere.
const FILLET_SUPPORTED_EDGES: Record<string, Set<string>> = {
  box: new Set(["vertical", "top", "bottom", "all"]),
  plate: new Set(["vertical", "top", "bottom", "all"]),
  tab: new Set(["vertical", "top", "bottom", "all"]),
  rounded_box: new Set(["vertical", "top", "bottom"]),
  cylinder: new Set(["top", "bottom"]),
  boss: new Set(["top", "bottom"]),
  extruded_profile: new Set(["vertical"]),
};

// Builds the edges argument expression for a bounded fillet/chamfer
// feature's `.fillet(edges, radius)`/`.chamfer(edges, distance)` call,
// restricted to FILLET_SUPPORTED_EDGES for the target's kind (see its
// comment above). For "vertical" this is a self-contained finder-callback
// expression (`(e) => e.inDirection([x, y, z])`, the target's own local Z
// axis rotated into world space via its own rotation and, if grouped, its
// transforming group's rotation -- a bare `'Z'` would be wrong for any
// rotated target, since it names world Z rather than the target's local
// Z); this already tolerates a patterned target with no special handling,
// since `.inDirection()` matches every edge in that direction across the
// whole shape regardless of how many disjoint instances it's made of
// (real-kernel-verified). For "top"/"bottom" it emits a face-lookup-then-
// `edgesOfFace()` statement pair per (ownPatternOffset, groupPatternOffset)
// combination -- just one pair for an unpatterned target, since both
// offset lists default to `[ZERO]` -- and combines every instance's edges
// into one array via spread, so a single `.fillet()`/`.chamfer()` call
// covers every actual instance instead of silently affecting only the one
// a single point-based lookup would have found (real-kernel-verified: the
// combined array fillets/chamfers all instances correctly, and confirmed
// this is genuinely necessary -- an unreplicated lookup on a 3-instance
// compound only affected one instance, leaving the other two sharp). Returns
// null (with a warning) if the target's kind doesn't support the requested
// selector at all.
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
  assign: (prefix: string, expr: string) => string,
  warnings: string[],
): string | null {
  const supported = FILLET_SUPPORTED_EDGES[kind];
  if (!supported?.has(edgesSelector)) {
    warnings.push(
      `feature ${featureId} (${featureKind}) targets component ${targetId} (kind "${kind}"), which does not support edges "${edgesSelector}" in the composable_part brepjs generator; the ${featureKind} was not applied`,
    );
    return null;
  }
  if (edgesSelector === "vertical") {
    const dir = worldRotatePoint(targetId, [0, 0, 1]);
    return `(e) => e.inDirection([${n(dir[0])}, ${n(dir[1])}, ${n(dir[2])}])`;
  }
  if (edgesSelector === "all") {
    // Every edge on the target, via brepjs's edgeFinder().findAll() -- no
    // face lookup or per-instance replication needed (unlike "top"/
    // "bottom"), since findAll() already walks the whole shape (every
    // instance of a patterned/compound target included) with no filter.
    return `edgeFinder().findAll(${currentVar})`;
  }
  const localPt = localAnchor("attached_to_face", edgesSelector, kind, dims);
  const edgeVars: string[] = [];
  for (const ownOffset of instanceOffsets.own) {
    for (const groupOffset of instanceOffsets.group) {
      const worldPt = worldPointForGroupInstance(targetId, localPt, groupOffset, ownOffset);
      const faceVar = assign(
        `face_${featureId}`,
        `unwrap(faceFinder().atDistance(0, [${n(worldPt[0])}, ${n(worldPt[1])}, ${n(worldPt[2])}]).findUnique(${currentVar}))`,
      );
      edgeVars.push(assign(`edges_${featureId}`, `edgesOfFace(${faceVar})`));
    }
  }
  if (edgeVars.length === 1) return edgeVars[0];
  return `[${edgeVars.map((v) => `...${v}`).join(", ")}]`;
}

export type ComposablePartResult = {
  supported: boolean;
  code: string;
  message?: string;
  warnings: string[];
};

export type ComposablePartGenerateOptions = {
  // Instead of fusing every "add" component into one final part, emit a
  // module whose default export is just this one component or feature's
  // own resolved shape -- for inspecting a single piece (its own volume,
  // bounds, validity) via scripts/brepjs-verify or an MCP-style run_program
  // tool, without hand-deriving combined-shape math or authoring a separate
  // throwaway spec that isolates it. The rest of the module (every other
  // line, every warning) is generated exactly as it would be for the whole
  // part -- only the final `export default` line differs -- so a feature
  // that depends on other components (a hole's target, a relation's
  // anchor) still resolves against the real, full assembly. Must name a
  // component id, a feature id whose kind has a standalone shape of its own
  // (hole/slot/counterbore/countersink/text/thread -- not shell/fillet/
  // chamfer, which modify their target's shape in place and have no
  // separate shape to isolate), or a group id (fuses that group's own live
  // members' shapes -- the same subset a feature targeting the group would
  // cut, not the group's own transform wrapper, since a group has no shape
  // beyond its members').
  isolate?: string;
};

export function generateComposablePartBrepJs(
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
  // Resolves a feature's `target` down to the component id(s) whose solid
  // the feature's cut should actually apply to: itself if it's a component,
  // every member if it's a group, or (for a stacked feature, like a
  // counterbore on top of a hole) recursively through the target feature's
  // own `target`. Semantic validation guarantees this chain has no cycles
  // (see the `target`-as-dependency-edge note in semantic.ts).
  function resolveFeatureCsgTargets(targetId: string): string[] {
    if (componentsById.has(targetId)) return [targetId];
    const group = groupsById.get(targetId);
    if (group) return group.memberIds ?? [];
    const targetFeature = featuresById.get(targetId);
    return targetFeature?.target ? resolveFeatureCsgTargets(targetFeature.target) : [];
  }
  // Only a group with its own position/rotation/relation/pattern moves its
  // members; semantic validation guarantees a component belongs to at most
  // one such group, so this lookup is unambiguous. Built before the
  // resolver since resolveOwn()'s anchor computation (via worldPosition())
  // needs it.
  const transformingGroupOf = new Map<string, string>();
  for (const g of groups)
    if (g.position != null || g.rotation != null || g.relation != null || g.pattern != null)
      for (const memberId of g.memberIds ?? []) transformingGroupOf.set(memberId, g.id);

  // A component with its own `pattern`, or belonging to a transforming
  // group that has one, has multiple instances already fused into its
  // single shapesById entry (see buildPatternedGeometry()/
  // placedComponentExpr()). Shared by every whole-shape feature (shell,
  // fillet, chamfer) that identifies a face/edge via a single world point:
  // that lookup only finds one instance's geometry, so applying the
  // feature to the whole fused entry would silently affect just that one
  // instance and leave the rest untouched.
  const targetHasMultipleInstances = (targetId: string): boolean => {
    const gid = transformingGroupOf.get(targetId);
    return !!(componentsById.get(targetId)?.pattern || (gid && groupsById.get(gid)?.pattern));
  };

  // The two independent pattern axes a target's instances can come from:
  // its own `pattern` (offsets applied before its own rotation, per
  // buildPatternedGeometry()) and its transforming group's `pattern`
  // (offsets applied before the group's rotation, per
  // placedComponentExpr()). Returns `[ZERO]` for either axis that doesn't
  // apply, so the cartesian product (own × group) is always at least one
  // entry -- the ordinary unpatterned case. Used by fillet/chamfer's
  // "top"/"bottom" edge selector to replicate its face lookup across every
  // actual instance of a patterned target, real-kernel-verified to combine
  // correctly into a single .fillet()/.chamfer() call (see
  // buildBoundedEdgesExpr()) -- unlike shell, which real-kernel testing
  // confirmed throws outright on a compound of disjoint solids regardless
  // of how the faces to remove were found, so shell has no equivalent and
  // stays hard-blocked via targetHasMultipleInstances() above.
  const targetPatternInstanceOffsets = (targetId: string): { own: Vec3[]; group: Vec3[] } => {
    const own = patternOffsets(componentsById.get(targetId)?.pattern);
    const gid = transformingGroupOf.get(targetId);
    const group = gid ? patternOffsets(groupsById.get(gid)?.pattern) : [ZERO];
    return { own, group };
  };

  const { resolveOwn, worldPointForGroupInstance, worldRotatePoint } = buildResolver(
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

  // Applies `targetId`'s own fully-resolved rotation (its own `rotation`,
  // further composed with its transforming group's `rotation`, if grouped,
  // and recursively with whatever rotation the target *itself* inherited
  // from its own relation target, if it also set inheritRotation) as an
  // additional rotation stage on `expr`, for a relation with
  // `inheritRotation: true`. Mirrors placedComponentExpr()'s own two-stage
  // (own rotation, then group rotation) composition exactly, just applied
  // to a *different* node's shape and with no translation, since this only
  // orients -- the caller's own anchor-position resolution (unaffected by
  // this) already places the result correctly. The recursive case matters:
  // without it, a node three levels deep in an inheritRotation chain would
  // only pick up its immediate target's own rotation field, missing
  // whatever that target itself inherited -- silently landing at the right
  // anchor point but the wrong orientation, exactly the kind of mistake
  // this feature exists to prevent. Semantic validation already guarantees
  // the underlying relation graph has no cycles, so no depth guard is
  // needed here, consistent with resolveOwn()/worldPosition() elsewhere in
  // this file.
  function applyInheritedRotation(expr: string, targetId: string): string {
    let out = applyTransform(expr, resolveOwn(targetId).rotation, ZERO);
    const gid = transformingGroupOf.get(targetId);
    if (gid) out = applyTransform(out, resolveOwn(gid).rotation, ZERO);
    const targetNode = nodesById.get(targetId);
    const targetRel = targetNode
      ? effectiveRelation(targetNode, featureIdSet.has(targetId))
      : undefined;
    if (targetRel?.inheritRotation) out = applyInheritedRotation(out, targetRel.target);
    return out;
  }

  function placedComponentExpr(c: any): string {
    const local = buildPatternedGeometry(c.kind, c.dimensions, c.pattern);
    const own = resolveOwn(c.id);
    let oriented = applyTransform(local, own.rotation, ZERO);
    const rel = effectiveRelation(c, false);
    if (rel?.inheritRotation) oriented = applyInheritedRotation(oriented, rel.target);
    const placed = applyTransform(oriented, ZERO, own.position);
    const gid = transformingGroupOf.get(c.id);
    if (!gid) return placed;
    const g = resolveOwn(gid);
    // The group's own pattern (if set) repeats the *whole member*, not just
    // this one instance's position: each pattern offset is applied to the
    // member's already-own-placed geometry, in the group's own (pre-group-
    // rotation) local frame -- so the offsets rotate together with the
    // group's own `rotation`, the same convention buildPatternedGeometry()
    // already uses for a component's own pattern (offsets applied before
    // that component's own rotation). All instances then get the group's
    // rotation and position applied once, together.
    const groupOffsets = patternOffsets(groupsById.get(gid)?.pattern);
    if (groupOffsets.length <= 1) return applyTransform(placed, g.rotation, g.position);
    const instanceAt = (o: Vec3) =>
      applyTransform(applyTransform(placed, ZERO, o), g.rotation, g.position);
    let combined = instanceAt(groupOffsets[0]);
    for (const o of groupOffsets.slice(1))
      combined = `shape(${combined}).fuse(${instanceAt(o)}).val`;
    return combined;
  }

  const lines: string[] = [];
  let varCounter = 0;
  function assign(prefix: string, expr: string): string {
    const name = `${prefix}_${varCounter++}`;
    lines.push(`const ${name} = ${expr};`);
    return name;
  }

  // A text feature needs a font loaded (via top-level `await`, valid at an
  // ES module's top level, and guaranteed by the module spec to delay the
  // module's resolution -- including for a plain dynamic `import()`, real-
  // kernel-verified -- until it completes) before any `sketchText()` call
  // can reference it, since brepjs has no bundled default font. Each unique
  // `fontUrl` across every text feature is loaded exactly once, upfront,
  // under a stable `font_N` family key, regardless of where in `features`
  // the text feature(s) that use it are declared -- this sidesteps needing
  // to interleave font-loading with feature processing to guarantee
  // "loaded before used".
  const fontFamilyByUrl = new Map<string, string>();
  for (const f of features) {
    if (f.kind !== "text") continue;
    const url = f.parameters?.fontUrl;
    if (url && !fontFamilyByUrl.has(url)) fontFamilyByUrl.set(url, `font_${fontFamilyByUrl.size}`);
  }
  for (const [url, family] of fontFamilyByUrl)
    lines.push(`unwrap(await loadFont(${JSON.stringify(url)}, ${JSON.stringify(family)}));`);

  const indexById = new Map<string, number>();
  components.forEach((c, i) => indexById.set(c.id, i));
  const addOrder: string[] = [];
  const shapesById = new Map<string, string>();
  // Captures each feature's own placed cut/emboss shape (hole/slot/
  // counterbore/countersink/text/thread -- the kinds buildFeatureCut()
  // handles), keyed by feature id, so `options.isolate` (see the end of
  // this function) can target a feature id directly, not just a component
  // id. shell/fillet/chamfer have no standalone shape of their own (they
  // modify their target's shape in place) and so are never present here.
  const featureShapesById = new Map<string, string>();

  for (const c of components) {
    if (c.operation !== "add") continue;
    const varName = assign(`comp_${c.id}`, placedComponentExpr(c));
    shapesById.set(c.id, varName);
    addOrder.push(c.id);
  }
  // "subtract" and "intersect" share identical appliesTo/ordering/warning
  // semantics -- an "intersect" component trims every targeted "add"
  // component down to just its overlap with the intersect component's own
  // shape, the same way "subtract" cuts material away, just with brepjs's
  // `.intersect()` instead of `.cut()`. Processed together, in one pass over
  // `components` in their original declaration order, so a subtract and an
  // intersect component interleave correctly relative to each other (not
  // "every subtract, then every intersect") -- matching how their shared
  // default appliesTo ("every add declared before this component's own
  // index") already depends on declaration order.
  for (const c of components) {
    if (c.operation !== "subtract" && c.operation !== "intersect") continue;
    const thisIndex = indexById.get(c.id)!;
    const targets: string[] =
      c.appliesTo ?? addOrder.filter((id) => indexById.get(id)! < thisIndex);
    const liveTargets = targets.filter((id) => shapesById.has(id));
    const method = c.operation === "subtract" ? "cut" : "intersect";
    if (liveTargets.length === 0) {
      // Either every appliesTo id refers to a component that's never an
      // "add" shape (for example another subtract/intersect-only
      // component), or (the default, no appliesTo, case) this component was
      // declared before any add component, so "every add declared earlier"
      // is empty. Both are easy authoring mistakes -- warn instead of
      // silently dropping the operation, the same as an unresolvable
      // feature target.
      warnings.push(
        `component ${c.id} (${c.operation}) does not apply to any "add" component; the ${method === "cut" ? "cut" : "intersection"} was not applied`,
      );
      continue;
    }
    const operandVar = assign(`${method}_${c.id}`, placedComponentExpr(c));
    for (const targetId of liveTargets) {
      const current = shapesById.get(targetId)!;
      const newVar = assign(`comp_${targetId}_${method}`, `shape(${current}).${method}(${operandVar}).val`);
      shapesById.set(targetId, newVar);
    }
  }

  // Walks a feature's (or, recursively, a stacked feature's) effective
  // relation target to find the transforming group -- if any -- its
  // position ultimately anchors to, so that group's *pattern* (if it has
  // one) can be found. worldPosition()/resolveOwn() already resolve a
  // feature's position correctly for a *single* instance of a patterned
  // group (its own anchor), but treat the whole group as if it had only
  // that one instance; a feature targeting a member of a patterned group
  // needs its own cut replicated across every instance too, the same way
  // placedComponentExpr() already replicates a patterned group's own
  // members' geometry. depth guards against runaway recursion; semantic
  // validation already guarantees the underlying relation graph has no
  // cycles, so this is just a straightforward chain walk.
  function findTargetPatternGroup(node: any, isFeature: boolean, depth = 0): any | undefined {
    if (depth > components.length + features.length + groups.length) return undefined;
    const rel = effectiveRelation(node, isFeature);
    if (!rel) return undefined;
    const asGroup = groupsById.get(rel.target);
    if (asGroup?.pattern) return asGroup;
    const gid = transformingGroupOf.get(rel.target);
    if (gid) return groupsById.get(gid);
    if (featureIdSet.has(rel.target)) {
      const targetFeature = nodesById.get(rel.target);
      if (targetFeature) return findTargetPatternGroup(targetFeature, true, depth + 1);
    }
    return undefined;
  }

  // Features are cut from the specific component(s) they target -- the same
  // scoping already used for subtract components' appliesTo, above -- not
  // from the whole fused assembly. Cutting the whole assembly would let a
  // "through" hole/slot's generous, deliberately-oversized cutter bleed into
  // any other component that happens to sit along its axis, silently
  // producing an unintended hole in something the feature never named.
  for (const f of features) {
    // shell is a whole-shape modifier, not a subtractive cutter: it directly
    // replaces its target's current shapesById entry (in place, honoring
    // declaration order relative to other features on the same target, the
    // same as the cut path below) rather than producing something to
    // .cut() from it, so it's handled separately before the generic cut
    // path. A target with multiple pattern instances already fused into
    // one shape (its own `pattern`, or membership in a patterned
    // transforming group) is rejected with a warning rather than attempted:
    // real-kernel testing confirmed brepjs's shell() throws on a compound
    // of disjoint solids ("Shell operation failed"), so there is no way to
    // shell every instance in one call the way a cut's cutter can be
    // replicated and unioned first.
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
        const facesExpr = buildShellFacesExpr(
          f.id,
          targetId,
          info.kind,
          info.dims,
          openFaces,
          current,
          worldPointForGroupInstance,
          warnings,
        );
        if (!facesExpr) continue;
        const newVar = assign(
          `comp_${targetId}_shell`,
          `shape(${current}).shell(${facesExpr}, ${n(params.thickness)}).val`,
        );
        shapesById.set(targetId, newVar);
      }
      continue;
    }
    // fillet/chamfer are, like shell, whole-shape modifiers rather than
    // subtractive cutters -- see buildBoundedEdgesExpr's comment for the
    // face/edge-identification technique and exactly which (kind, edges)
    // combinations are supported.
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
      const method = f.kind === "fillet" ? "fillet" : "chamfer";
      const amount = f.kind === "fillet" ? params.radius : params.distance;
      for (const targetId of liveTargets) {
        const info = dimsOf(targetId);
        if (!info) continue;
        const current = shapesById.get(targetId)!;
        const edgesExpr = buildBoundedEdgesExpr(
          f.kind,
          f.id,
          targetId,
          info.kind,
          info.dims,
          params.edges,
          current,
          worldRotatePoint,
          worldPointForGroupInstance,
          targetPatternInstanceOffsets(targetId),
          assign,
          warnings,
        );
        if (!edgesExpr) continue;
        const newVar = assign(
          `comp_${targetId}_${method}`,
          `shape(${current}).${method}(${edgesExpr}, ${n(amount)}).val`,
        );
        shapesById.set(targetId, newVar);
      }
      continue;
    }
    const cutExpr = buildFeatureCut(f, warnings, fontFamilyByUrl, componentsById, featuresById);
    if (!cutExpr) continue;
    const embossing = featureAddsMaterial(f);
    const targets = f.target ? resolveFeatureCsgTargets(f.target) : [];
    const liveTargets = targets.filter((id) => shapesById.has(id));
    if (liveTargets.length === 0) {
      warnings.push(
        `feature ${f.id}'s target does not resolve to any "add" component; the ${embossing ? "emboss" : "cut"} was not applied`,
      );
      continue;
    }
    // A component's or feature's own pattern doesn't propagate through a
    // stacked feature (see docs/composable-parts.md, "Patterns") -- a
    // feature with no pattern of its own that targets a patterned component
    // or feature anchors to that pattern's single center point and is only
    // ever applied once, silently leaving every instance but the center one
    // unaffected (for example a counterbore stacked on a patterned hole,
    // forgetting to repeat the counterbore too, leaves most of the holes
    // plain). This is valid and sometimes intentional (a one-off feature on
    // just the "representative" instance), but easy to author by accident
    // with no other signal that anything unusual happened, unlike targeting
    // a patterned *group*, which already auto-propagates correctly (see
    // findTargetPatternGroup() above) and is deliberately excluded here.
    // Also excluded: an explicit relation.targetInstance, which is exactly
    // the deliberate, addressed version of this same "just one instance"
    // choice (see resolveOwn() above) -- not an accidental omission.
    const explicitTargetInstance = effectiveRelation(f, true)?.targetInstance != null;
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
        combined = `shape(${combined}).fuse(${instanceAt(o)}).val`;
      placedCut = combined;
    }

    const cutVar = assign(`featureCut_${f.id}`, placedCut);
    featureShapesById.set(f.id, cutVar);
    const op = embossing ? "fuse" : "cut";
    for (const targetId of liveTargets) {
      const current = shapesById.get(targetId)!;
      const newVar = assign(`comp_${targetId}_${op}`, `shape(${current}).${op}(${cutVar}).val`);
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

  // 'brepjs/text' (loadFont/sketchText) pulls in font-parsing (opentype.js)
  // weight that every other spec has no reason to pay for, unlike the fixed
  // 'brepjs' import list above (a handful of named exports from a module
  // already required either way) -- so, uniquely among this generator's
  // imports, it's only emitted when the spec actually has a text feature.
  const textImportLine =
    fontFamilyByUrl.size > 0 ? "import { loadFont, sketchText } from 'brepjs/text';\n" : "";
  const header = `// Generated by printspec 0.2.0\n// Review generated CAD before manufacturing.\n// composable_part: geometry is approximate where noted below; review before manufacturing.\nimport { box, cylinder, cone, sphere, torus, ellipsoid, shape, line, threePointArc, bezier, bsplineApprox, wire, wireLoop, face, extrude, revolve, loft, sweep, thread, unwrap, faceFinder, edgeFinder, edgesOfFace } from 'brepjs';\n${textImportLine}\n`;
  const finish = (exportExpr: string): ComposablePartResult => {
    const body = lines.join("\n");
    const code = `${header}${body}\n\nexport default () => ${exportExpr};\n`;
    return { supported: true, code, warnings };
  };

  if (options?.isolate != null) {
    let isolateVar = shapesById.get(options.isolate) ?? featureShapesById.get(options.isolate);
    if (isolateVar == null) {
      // A group id isolates the fuse of its own live members' shapes (the
      // same subset resolveFeatureCsgTargets() would use for a feature
      // targeting this group) -- not the group's own transformed placement
      // wrapper, since a group has no shape of its own beyond its members'.
      const group = groupsById.get(options.isolate);
      const liveMemberVars = (group?.memberIds ?? [])
        .map((id: string) => shapesById.get(id))
        .filter((v: string | undefined): v is string => v != null);
      if (liveMemberVars.length > 0)
        isolateVar = liveMemberVars.reduce((acc: string, v: string) => `shape(${acc}).fuse(${v}).val`);
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
    partVar = assign("part", `shape(${partVar}).fuse(${v}).val`);
  if (shapesById.size === 1) {
    const finalName = "part_0";
    lines.push(`const ${finalName} = ${partVar};`);
    partVar = finalName;
  }
  return finish(partVar);
}
