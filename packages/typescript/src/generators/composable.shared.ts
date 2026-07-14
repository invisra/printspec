// Shared, generator-agnostic composable_part logic: position/rotation/
// pattern/group resolution, AABB derivation, and the connectivity/clearance
// checks. Every function here computes plain numbers (or, for the two
// checks, plain warning strings) -- nothing brepjs- or CadQuery-specific --
// so both `brepjs.composable.ts` and `cadquery.composable.ts` import this
// module directly instead of maintaining two copies of the same position
// math, which is by far the most intricate and bug-prone part of either
// generator (relation anchoring, rotation composition, pattern instancing,
// group transforms all interact). Only the actual shape-construction code
// (buildComponentGeometry, buildProfileEdges, buildFeatureCut, and the
// per-line code assembly) is generator-specific and lives in each file.

export type Vec3 = [number, number, number];
export const ZERO: Vec3 = [0, 0, 0];

export function addV(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function negAxis(v: Vec3, axis: string): Vec3 {
  const i = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const out: Vec3 = [...v];
  out[i] = -out[i];
  return out;
}

// Rotates a point by extrinsic (fixed-axis) X, then Y, then Z rotations, in
// degrees -- the same convention documented for component/group rotation.
export function rotateExtrinsic(p: Vec3, rotDeg: Vec3): Vec3 {
  const [rx, ry, rz] = rotDeg.map((d) => (d * Math.PI) / 180);
  const [x0, y0, z0] = p;
  // Rx
  const y1 = y0 * Math.cos(rx) - z0 * Math.sin(rx);
  const z1 = y0 * Math.sin(rx) + z0 * Math.cos(rx);
  // Ry
  const x2 = x0 * Math.cos(ry) + z1 * Math.sin(ry);
  const z2 = -x0 * Math.sin(ry) + z1 * Math.cos(ry);
  // Rz
  const x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
  const y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
  return [x3, y3, z2];
}

// Every coordinate pair a profile's points array touches, including each
// vertex's own optional curve.through/curve.controlPoints -- needed for an
// accurate bounding box, since a curved segment (an arc bulging outward, or
// a bezier control point) can extend beyond the polygon formed by just the
// main vertices themselves. `coordsOf` extracts a [a, b] pair from any point
// shape (extruded_profile's {x,y} or revolved_profile's {radius,z}).
export function allProfileCoordinatePairs(
  points: { curve?: any }[],
  coordsOf: (p: any) => [number, number],
): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    out.push(coordsOf(p));
    const curve = (p as any).curve;
    if (curve?.type === "arc") out.push(coordsOf(curve.through));
    if (curve?.type === "bezier")
      for (const cp of curve.controlPoints) out.push(coordsOf(cp));
    if (curve?.type === "spline")
      for (const tp of curve.through) out.push(coordsOf(tp));
  }
  return out;
}

export function pointsBoundingBox(
  points: { x: number; y: number; curve?: any }[],
): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const coords = allProfileCoordinatePairs(points, (p) => [p.x, p.y]);
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// Bounding extent of a revolved_profile's cross-section, in the profile's
// own as-authored (radius, z) coordinates (before the Z shift). Shared by
// aabbExtents() (for relation anchors and the connectivity check) and each
// generator's own geometry builder (to actually shift the profile), so both
// agree on exactly the same box. maxRadius alone determines the revolved
// solid's footprint (it's rotationally symmetric around Z by construction),
// and the Z span determines its height, the same as every other kind's
// aabbExtents.
export function revolveProfileExtents(
  points: { radius: number; z: number; curve?: any }[],
): {
  maxRadius: number;
  minZ: number;
  maxZ: number;
} {
  const coords = allProfileCoordinatePairs(points, (p) => [p.radius, p.z]);
  const radii = coords.map((c) => c[0]);
  const zs = coords.map((c) => c[1]);
  return {
    maxRadius: Math.max(...radii),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

// AABB half-extents (X, Y) and full Z extent (base is always Z=0) for kinds
// with a clean footprint/depth split. rib/wedge/swept_profile return null,
// the same set of kinds excluded from hole/slot bounds-checking in
// semantic.ts/semantic.py.
export function aabbExtents(
  kind: string,
  dims: any,
): { hx: number; hy: number; z: number } | null {
  switch (kind) {
    case "box":
    case "rounded_box":
      return { hx: dims.length / 2, hy: dims.width / 2, z: dims.height };
    case "plate":
    case "tab":
      return { hx: dims.length / 2, hy: dims.width / 2, z: dims.thickness };
    case "cylinder":
    case "boss":
      return { hx: dims.diameter / 2, hy: dims.diameter / 2, z: dims.height };
    case "tube":
      return {
        hx: dims.outerDiameter / 2,
        hy: dims.outerDiameter / 2,
        z: dims.height,
      };
    case "extruded_profile": {
      const { minX, maxX, minY, maxY } = pointsBoundingBox(dims.points);
      return { hx: (maxX - minX) / 2, hy: (maxY - minY) / 2, z: dims.height };
    }
    case "sphere":
      return { hx: dims.diameter / 2, hy: dims.diameter / 2, z: dims.diameter };
    case "torus":
      return {
        hx: dims.outerDiameter / 2,
        hy: dims.outerDiameter / 2,
        z: dims.tubeDiameter,
      };
    case "ellipsoid":
      return { hx: dims.lengthX / 2, hy: dims.lengthY / 2, z: dims.lengthZ };
    case "revolved_profile": {
      const { maxRadius, minZ, maxZ } = revolveProfileExtents(dims.points);
      return { hx: maxRadius, hy: maxRadius, z: maxZ - minZ };
    }
    case "loft_profile": {
      // Conservative footprint: the largest half-extent any single section
      // has, after each is centered on its own local origin independently
      // -- this can underestimate for an exotic loft whose blended surface
      // bulges wider than every section's own footprint, but matches the
      // same "approximate, never too strict" precedent aabbExtents already
      // accepts elsewhere (for example the connectivity check's
      // bounding-box approximation).
      const zs = dims.profiles.map((p: { z: number }) => p.z);
      let hx = 0;
      let hy = 0;
      for (const profile of dims.profiles) {
        const { minX, maxX, minY, maxY } = pointsBoundingBox(profile.points);
        hx = Math.max(hx, (maxX - minX) / 2);
        hy = Math.max(hy, (maxY - minY) / 2);
      }
      return { hx, hy, z: Math.max(...zs) - Math.min(...zs) };
    }
    default:
      return null;
  }
}

// Local (target-frame) anchor offset for a relation type, per
// docs/composable-parts.md. Returns ZERO when the target's AABB is
// undefined (rib/wedge/swept_profile/group/feature target), which callers
// treat as the offset_from fallback (anchor at the target's own origin).
export function localAnchor(
  relType: string,
  face: string | undefined,
  kind: string,
  dims: any,
): Vec3 {
  const ext = aabbExtents(kind, dims);
  if (!ext) return ZERO;
  const { hx, hy, z } = ext;
  switch (relType) {
    case "on_top_of":
      return [0, 0, z];
    case "attached_to_face":
      switch (face) {
        case "top":
          return [0, 0, z];
        case "bottom":
          return [0, 0, 0];
        case "front":
          return [0, -hy, z / 2];
        case "back":
          return [0, hy, z / 2];
        case "left":
          return [-hx, 0, z / 2];
        case "right":
          return [hx, 0, z / 2];
        case "side":
          return [hx, 0, z / 2];
        default:
          return ZERO;
      }
    case "centered_on":
      return [0, 0, z / 2];
    default: // aligned_with, offset_from
      return ZERO;
  }
}

export type Resolved = { position: Vec3; rotation: Vec3 };

export type EffectiveRelation = {
  type: string;
  target: string;
  face?: string;
  mirrorAxis?: string;
  inheritRotation?: boolean;
  targetInstance?: number;
};

// A feature with a `target` but no explicit `relation` implicitly anchors to
// that target's origin (the "offset_from" rule) -- components and groups
// have no such fallback, since they have no `target` field.
export function effectiveRelation(
  node: any,
  isFeature: boolean,
): EffectiveRelation | undefined {
  if (node.relation?.target) return node.relation;
  if (isFeature && node.target)
    return { type: "offset_from", target: node.target };
  return undefined;
}

// Per-instance offsets for a component/feature's pattern, centered on the
// resolved position (docs/composable-parts.md formulas).
export function patternOffsets(pattern: any): Vec3[] {
  if (!pattern) return [ZERO];
  if (pattern.type === "rectangular") {
    const offsets: Vec3[] = [];
    for (let i = 0; i < pattern.countX; i++)
      for (let j = 0; j < pattern.countY; j++)
        offsets.push([
          (i - (pattern.countX - 1) / 2) * pattern.spacingX,
          (j - (pattern.countY - 1) / 2) * pattern.spacingY,
          0,
        ]);
    return offsets;
  }
  if (pattern.type === "linear") {
    const axisIdx = pattern.axis === "x" ? 0 : pattern.axis === "y" ? 1 : 2;
    const offsets: Vec3[] = [];
    for (let i = 0; i < pattern.count; i++) {
      const v: Vec3 = [0, 0, 0];
      v[axisIdx] = (i - (pattern.count - 1) / 2) * pattern.spacing;
      offsets.push(v);
    }
    return offsets;
  }
  if (pattern.type === "radial") {
    const count = pattern.count;
    const offsets: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      const angleDeg =
        pattern.sweepAngle != null
          ? (pattern.startAngle ?? 0) +
            (count === 1 ? 0 : (i * pattern.sweepAngle) / (count - 1))
          : (pattern.startAngle ?? 0) + (i * 360) / count;
      const rad = (angleDeg * Math.PI) / 180;
      offsets.push([
        pattern.radius * Math.cos(rad),
        pattern.radius * Math.sin(rad),
        0,
      ]);
    }
    return offsets;
  }
  return [ZERO];
}

// Resolves every component/feature/group's own transform (before any
// enclosing group is applied), by walking the relation graph in dependency
// order. Semantic validation already guarantees this graph (including the
// implicit "grouped component depends on its transforming group" edge added
// by the internal worldPosition() below) has no cycles, no self-references,
// no target-a-patterned-entity relations, and every target exists, so this
// is a straightforward memoized recursive resolve.
//
// resolveOwn() alone is NOT what other nodes should anchor to when the
// target is a member of a transforming group: it's the target's position
// before that group's own position/rotation is applied. The internal
// worldPosition() layers the enclosing group's transform on top, so a
// relation or feature targeting a grouped component anchors to where that
// component actually ends up, not its pre-group authoring-space position --
// see "Groups" in docs/composable-parts.md. A node's *own* code emission
// still uses resolveOwn() plus a separate group-transform stage in each
// generator, rather than worldPosition(), so the group's rotation is
// composed by real runtime rotation math (two chained rotate calls) instead
// of being flattened into one Euler triple, which isn't generally valid.
export function buildResolver(
  nodesById: Map<string, any>,
  isFeatureId: (id: string) => boolean,
  dimsOf: (id: string) => { kind: string; dims: any } | null,
  transformingGroupOf: Map<string, string>,
) {
  const ownCache = new Map<string, Resolved>();
  const worldCache = new Map<string, Vec3>();

  function resolveOwn(id: string): Resolved {
    const cached = ownCache.get(id);
    if (cached) return cached;
    const node = nodesById.get(id);
    const ownRotation: Vec3 = node?.rotation
      ? [node.rotation.x ?? 0, node.rotation.y ?? 0, node.rotation.z ?? 0]
      : ZERO;
    const ownOffset: Vec3 = node?.position
      ? [node.position.x ?? 0, node.position.y ?? 0, node.position.z ?? 0]
      : ZERO;
    const rel = node ? effectiveRelation(node, isFeatureId(id)) : undefined;
    let anchor: Vec3 = ZERO;
    if (rel) {
      // relation.targetInstance (semantic-validation-guaranteed to be in
      // range, and only ever set on a component/feature target's own
      // pattern -- not a group's, and not an unpatterned target) anchors to
      // one specific instance of the target's pattern instead of its
      // center: the instance's own local-frame offset (patternOffsets()'s
      // per-instance formula) is just another vector in the target's own
      // un-rotated local frame, exactly like localAnchor()'s relation-type
      // offset below, so it's resolved into world space the same way (via
      // worldRotatePoint(), which already composes the target's own,
      // inherited, and group rotation) rather than needing separate
      // handling.
      const targetInstanceOffset =
        rel.targetInstance != null
          ? (patternOffsets(nodesById.get(rel.target)?.pattern)[
              rel.targetInstance
            ] ?? ZERO)
          : ZERO;
      const targetInstanceWorldPosition = addV(
        worldPosition(rel.target),
        worldRotatePoint(rel.target, targetInstanceOffset),
      );
      if (rel.type === "mirrored_from") {
        anchor = negAxis(targetInstanceWorldPosition, rel.mirrorAxis ?? "x");
      } else {
        const targetShape = dimsOf(rel.target);
        const local = targetShape
          ? localAnchor(rel.type, rel.face, targetShape.kind, targetShape.dims)
          : ZERO;
        anchor = addV(
          targetInstanceWorldPosition,
          worldRotatePoint(rel.target, local),
        );
      }
    }
    const resolved: Resolved = {
      position: addV(anchor, ownOffset),
      rotation: ownRotation,
    };
    ownCache.set(id, resolved);
    return resolved;
  }

  function worldPosition(id: string): Vec3 {
    const cached = worldCache.get(id);
    if (cached) return cached;
    const own = resolveOwn(id);
    const gid = transformingGroupOf.get(id);
    const result = gid
      ? addV(
          resolveOwn(gid).position,
          rotateExtrinsic(own.position, resolveOwn(gid).rotation),
        )
      : own.position;
    worldCache.set(id, result);
    return result;
  }

  // Rotates a vector `v`, defined in `id`'s own oriented local frame, by
  // `id`'s own rotation composed with, recursively, whatever rotation `id`
  // itself inherits from its own relation target (relation.inheritRotation)
  // -- but NOT id's own transforming group's rotation, which callers that
  // need it apply as a separate, final stage. This is the numeric-point
  // twin of each generator's own applyInheritedRotation() (which does the
  // same own-then-group-then-recurse composition on a code-expression
  // string instead of a literal vector): a node whose effective orientation
  // is inherited rather than self-authored still needs anything anchored to
  // it -- a relation, a fillet/chamfer's "vertical" direction, a shell's
  // face-lookup point -- rotated by its *true* world orientation, not just
  // its own (possibly all-zero) `rotation` field.
  function rotateByOwnAndInherited(id: string, v: Vec3): Vec3 {
    const out = rotateExtrinsic(v, resolveOwn(id).rotation);
    const node = nodesById.get(id);
    const rel = node ? effectiveRelation(node, isFeatureId(id)) : undefined;
    return rel?.inheritRotation ? worldRotatePoint(rel.target, out) : out;
  }

  // Rotates a vector `v`, defined in `id`'s own oriented local frame (for
  // example a footprint-relative anchor offset like on_top_of's [0,0,z]),
  // into world space: `id`'s own rotation (composed with any inherited
  // rotation, see rotateByOwnAndInherited above) first, then its enclosing
  // transforming group's rotation, if any -- the same order each
  // generator's own placedComponentExpr()-equivalent applies to the node's
  // actual geometry (own rotate+translate, then group rotate+translate), so
  // a relation anchoring to a grouped *and* rotated component (for example
  // on_top_of a component inside a rotating group) computes the anchor
  // against where that component's top face actually ends up, not where it
  // would be without the group's rotation.
  function worldRotatePoint(id: string, v: Vec3): Vec3 {
    const afterOwn = rotateByOwnAndInherited(id, v);
    const gid = transformingGroupOf.get(id);
    return gid ? rotateExtrinsic(afterOwn, resolveOwn(gid).rotation) : afterOwn;
  }

  // Maps an arbitrary point `p` in `id`'s own local (un-rotated, un-placed)
  // frame into world space, for one instance of `id`'s own pattern
  // (`ownPatternOffset`, one of patternOffsets(component.pattern), applied
  // to `p` before `id`'s own rotation/position) and/or one instance of a
  // transforming group's pattern (`groupOffset`, one of
  // patternOffsets(group.pattern), applied after `id`'s own placement but
  // before the group's rotation/position). Pass ZERO for either offset when
  // that particular pattern doesn't apply (an unpatterned node, an
  // ungrouped node, or a node whose group isn't itself patterned). Used for
  // approximating a component's world-space bounding box (the connectivity
  // check) and for replicating a shell/fillet/chamfer feature's face-lookup
  // point across every instance of a patterned target.
  function worldPointForGroupInstance(
    id: string,
    p: Vec3,
    groupOffset: Vec3,
    ownPatternOffset: Vec3 = ZERO,
  ): Vec3 {
    const own = resolveOwn(id);
    const ownPlaced = addV(
      rotateByOwnAndInherited(id, addV(p, ownPatternOffset)),
      own.position,
    );
    const gid = transformingGroupOf.get(id);
    if (!gid) return ownPlaced;
    const g = resolveOwn(gid);
    return addV(
      rotateExtrinsic(addV(ownPlaced, groupOffset), g.rotation),
      g.position,
    );
  }

  return { resolveOwn, worldPointForGroupInstance, worldRotatePoint };
}

export type WorldAabb = { min: Vec3; max: Vec3 };

// Approximates an "add" component's world-space axis-aligned bounding box
// for *one* instance (one particular combination of the component's own
// pattern offset and its transforming group's pattern offset), by
// transforming its 8 local-frame corners (from aabbExtents(), the same
// footprint/depth model used for hole/slot bounds-checking elsewhere) with
// worldPointForGroupInstance(). rib/wedge/swept_profile have no clean
// footprint/depth split (see aabbExtents()), so they're skipped -- not
// treated as "definitely connected" or "definitely disconnected", just left
// out of the check entirely.
export function instanceAabb(
  c: any,
  worldPointForGroupInstance: (
    id: string,
    p: Vec3,
    groupOffset: Vec3,
    ownPatternOffset?: Vec3,
  ) => Vec3,
  groupOffset: Vec3,
  ownPatternOffset: Vec3,
): WorldAabb | null {
  const ext = aabbExtents(c.kind, c.dimensions);
  if (!ext) return null;
  const { hx, hy, z } = ext;
  const corners: Vec3[] = [];
  for (const x of [-hx, hx])
    for (const y of [-hy, hy])
      for (const zc of [0, z])
        corners.push(
          worldPointForGroupInstance(
            c.id,
            [x, y, zc],
            groupOffset,
            ownPatternOffset,
          ),
        );
  const axis = (i: number) => corners.map((p) => p[i]);
  return {
    min: [Math.min(...axis(0)), Math.min(...axis(1)), Math.min(...axis(2))],
    max: [Math.max(...axis(0)), Math.max(...axis(1)), Math.max(...axis(2))],
  };
}

// One bounding box per *actual instance* of a component -- the cartesian
// product of its own pattern offsets (just [ZERO] if it has no `pattern`)
// and its transforming group's pattern offsets (just [ZERO] if ungrouped or
// its group is unpatterned) -- rather than one combined envelope spanning
// all of them. This matters because a pattern's per-instance offset formula
// (see patternOffsets()) is always symmetric about its anchor, so an
// envelope always reaches back through the anchor point regardless of how
// far apart the actual instances are.
export function instanceAabbsOf(
  c: any,
  worldPointForGroupInstance: (
    id: string,
    p: Vec3,
    groupOffset: Vec3,
    ownPatternOffset?: Vec3,
  ) => Vec3,
  groupOffsets: Vec3[],
  ownPatternOffsets: Vec3[],
): WorldAabb[] {
  const boxes: WorldAabb[] = [];
  for (const groupOffset of groupOffsets)
    for (const ownOffset of ownPatternOffsets) {
      const box = instanceAabb(
        c,
        worldPointForGroupInstance,
        groupOffset,
        ownOffset,
      );
      if (box) boxes.push(box);
    }
  return boxes;
}

export function aabbsTouchOrOverlap(
  a: WorldAabb,
  b: WorldAabb,
  epsilon = 1e-6,
): boolean {
  return (
    a.min[0] <= b.max[0] + epsilon &&
    a.max[0] >= b.min[0] - epsilon &&
    a.min[1] <= b.max[1] + epsilon &&
    a.max[1] >= b.min[1] - epsilon &&
    a.min[2] <= b.max[2] + epsilon &&
    a.max[2] >= b.min[2] - epsilon
  );
}

// Warns (doesn't reject -- a deliberately multi-piece spec is plausible,
// just unusual) when the "add" components don't form a single connected
// group, approximated via bounding-box touch/overlap rather than real
// boolean geometry: a real per-pair boolean interference check would need an
// actual kernel, which this source-only generator never runs. This is
// deliberately approximate (it can miss a real gap between two components
// whose *boxes* still overlap) but catches the most likely authoring
// mistake for a spec composed without ever rendering it: a component
// positioned with a gap from the rest of the part.
export function checkAssemblyConnectivity(
  components: any[],
  worldPointForGroupInstance: (
    id: string,
    p: Vec3,
    groupOffset: Vec3,
    ownPatternOffset?: Vec3,
  ) => Vec3,
  transformingGroupOf: Map<string, string>,
  groupsById: Map<string, any>,
): string | null {
  const addComponents = components.filter((c) => c.operation === "add");
  const instanceBoxesById = new Map<string, WorldAabb[]>();
  for (const c of addComponents) {
    const gid = transformingGroupOf.get(c.id);
    const groupOffsets = gid
      ? patternOffsets(groupsById.get(gid)?.pattern)
      : [ZERO];
    const ownPatternOffsets = patternOffsets(c.pattern);
    const boxes = instanceAabbsOf(
      c,
      worldPointForGroupInstance,
      groupOffsets,
      ownPatternOffsets,
    );
    if (boxes.length > 0) instanceBoxesById.set(c.id, boxes);
  }
  const ids = [...instanceBoxesById.keys()];
  if (ids.length <= 1) return null;

  const parent = new Map(ids.map((id) => [id, id]));
  function find(id: string): string {
    while (parent.get(id) !== id) id = parent.get(id)!;
    return id;
  }
  // Two components "touch" if *any* instance of one touches *any* instance
  // of the other -- not if their combined envelopes touch (see
  // instanceAabbsOf() above for why that's insufficient once either side is
  // patterned).
  const anyInstancesTouch = (a: WorldAabb[], b: WorldAabb[]) =>
    a.some((boxA) => b.some((boxB) => aabbsTouchOrOverlap(boxA, boxB)));
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      if (
        anyInstancesTouch(
          instanceBoxesById.get(ids[i])!,
          instanceBoxesById.get(ids[j])!,
        )
      ) {
        const [ra, rb] = [find(ids[i]), find(ids[j])];
        if (ra !== rb) parent.set(ra, rb);
      }

  const clusters = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    const list = clusters.get(root) ?? [];
    list.push(id);
    clusters.set(root, list);
  }
  if (clusters.size <= 1) return null;
  const groups = [...clusters.values()]
    .map((g) => `[${g.sort().join(", ")}]`)
    .sort();
  return (
    `components do not appear to form a single connected part (approximate bounding-box check): ` +
    `${groups.join(" and ")} don't touch or overlap each other -- review positions/relations if ` +
    `this is unintentional (rib/wedge/swept_profile components are excluded from this check)`
  );
}

// Minimum Euclidean distance between two axis-aligned bounding boxes: 0 if
// they touch or overlap on every axis, otherwise the straight-line distance
// between their nearest corners/edges/faces.
export function aabbDistance(a: WorldAabb, b: WorldAabb): number {
  const gap = (i: number) =>
    Math.max(0, b.min[i] - a.max[i], a.min[i] - b.max[i]);
  const gx = gap(0);
  const gy = gap(1);
  const gz = gap(2);
  return Math.sqrt(gx * gx + gy * gy + gz * gz);
}

// Evaluates every `clearance` constraint's actual minimum gap -- the one
// thing semantic validation (shared by both languages) can't do, since it
// needs each component's fully resolved world position. Approximated the
// same way the connectivity check above already is: via each component's
// axis-aligned bounding box (every pattern instance of it, own and/or
// group), not real boolean geometry. A component that doesn't resolve at
// all (unknown id) or has no well-defined AABB (rib/wedge/swept_profile) is
// silently skipped here, since semantic validation already rejects both as
// a hard error before generation would even be attempted.
export function checkClearanceConstraints(
  constraints: any[],
  componentsById: Map<string, any>,
  transformingGroupOf: Map<string, string>,
  groupsById: Map<string, any>,
  worldPointForGroupInstance: (
    id: string,
    p: Vec3,
    groupOffset: Vec3,
    ownPatternOffset?: Vec3,
  ) => Vec3,
  n: (value: unknown) => string,
): string[] {
  const warnings: string[] = [];
  const instanceBoxesOf = (component: any): WorldAabb[] => {
    const gid = transformingGroupOf.get(component.id);
    const groupOffsets = gid
      ? patternOffsets(groupsById.get(gid)?.pattern)
      : [ZERO];
    return instanceAabbsOf(
      component,
      worldPointForGroupInstance,
      groupOffsets,
      patternOffsets(component.pattern),
    );
  };
  constraints.forEach((c, i) => {
    if (c?.type !== "clearance") return;
    const label = c.id ?? `#${i}`;
    const compA = componentsById.get(c.a);
    const compB = componentsById.get(c.b);
    if (!compA || !compB) return;
    const boxesA = instanceBoxesOf(compA);
    const boxesB = instanceBoxesOf(compB);
    if (boxesA.length === 0 || boxesB.length === 0) return;
    let minGap = Infinity;
    for (const boxA of boxesA)
      for (const boxB of boxesB)
        minGap = Math.min(minGap, aabbDistance(boxA, boxB));
    if (minGap < c.minDistance)
      warnings.push(
        `constraint ${label} (clearance) failed: ${c.a}/${c.b} are only ${n(minGap)}mm apart ` +
          `(approximate bounding-box check), less than the required ${n(c.minDistance)}mm`,
      );
  });
  return warnings;
}
