function dup(values: string[], label: string) {
  const seen = new Set<string>();
  const e: string[] = [];
  for (const v of values) {
    if (seen.has(v)) e.push(`duplicate ${label} id: ${v}`);
    seen.add(v);
  }
  return e;
}

// Total instance count a pattern produces, purely from its own authored
// counts -- no position resolution needed, so (unlike anything that would
// need brepjs.composable.ts's resolver) this is safe to compute in shared
// semantic validation. Matches patternOffsets() in brepjs.composable.ts's
// own per-type instance counts exactly.
function patternInstanceCount(pattern: any): number {
  if (!pattern) return 1;
  if (pattern.type === "rectangular") return pattern.countX * pattern.countY;
  return pattern.count;
}

// Ceiling on total composable-part geometric complexity. The schema's maxItems
// caps the raw component/feature/group counts, but a single 100x100 rectangular
// pattern already expands to 10,000 solid instances, and a spec could multiply
// that across many entities into a kernel-exhausting (DoS) workload. This bounds
// the number of instances the kernel must actually build once patterns are
// expanded.
const MAX_TOTAL_INSTANCES = 20000;

function entityInstances(entity: any): number {
  const n = patternInstanceCount(entity?.pattern);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function complexityErrors(part: any): string[] {
  const sumInstances = (items: any[] | undefined) =>
    (items ?? []).reduce((n: number, x: any) => n + entityInstances(x), 0);
  const entityInstanceTotal =
    sumInstances(part.components) + sumInstances(part.features);
  // A group pattern repeats all of its members, so multiply by the largest
  // group pattern. Assuming every entity falls under it is a deliberate
  // over-estimate -- the safe direction for a resource ceiling.
  const maxGroupPattern = (part.groups ?? []).reduce(
    (m: number, g: any) => Math.max(m, entityInstances(g)),
    1,
  );
  const total = entityInstanceTotal * maxGroupPattern;
  if (total > MAX_TOTAL_INSTANCES)
    return [
      `composable_part expands to ~${total} pattern instances, exceeding the ${MAX_TOTAL_INSTANCES} limit -- reduce component/feature counts or pattern repetition`,
    ];
  return [];
}

// Finds cycles in a directed graph where a node may have more than one
// outgoing edge -- a component/feature/group has at most one `relation`
// edge, but a component may *also* have an implicit edge to its
// transforming group (its world position depends on that group's own
// resolved transform; see worldPosition() in brepjs.composable.ts), so the
// graph isn't a strict one-edge-per-node functional graph.
function relationCycles(edges: Map<string, string[]>): string[][] {
  const state = new Map<string, 1 | 2>();
  const cycles: string[][] = [];
  const path: string[] = [];
  function visit(node: string) {
    state.set(node, 1);
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const s = state.get(next);
      if (s === undefined) visit(next);
      else if (s === 1) {
        const idx = path.indexOf(next);
        cycles.push([...path.slice(idx), next]);
      }
    }
    path.pop();
    state.set(node, 2);
  }
  for (const start of edges.keys()) if (!state.has(start)) visit(start);
  return cycles;
}
// Maps a component kind to the dimension key used for hole/slot footprint (X/Y
// in-plane) and depth (Z) sanity checks. Kinds without a clean footprint/depth
// split (rib, wedge) are intentionally omitted, so they are not checked.
// ellipsoid is intentionally omitted, the same as rib/wedge: its X and Y
// extents can differ (lengthX vs lengthY), so it has no single "footprint"
// number a hole/slot/shell/fillet/chamfer bound check could correctly
// compare against without silently ignoring whichever axis is smaller.
const FOOTPRINT_DIM: Record<string, string> = {
  box: "width",
  rounded_box: "width",
  plate: "width",
  tab: "width",
  cylinder: "diameter",
  boss: "diameter",
  tube: "outerDiameter",
  sphere: "diameter",
  torus: "outerDiameter",
};
const DEPTH_DIM: Record<string, string> = {
  box: "height",
  rounded_box: "height",
  plate: "thickness",
  tab: "thickness",
  cylinder: "height",
  boss: "height",
  tube: "height",
  sphere: "diameter",
  torus: "tubeDiameter",
};

// Sanity-checks a hole/slot feature's size against its target component's
// dimensions; only for the default (z) axis, since the footprint/depth
// mapping is ambiguous for x/y axes and unmapped kinds (rib, wedge).
function featureFitErrors(feature: any, targetComponent: any): string[] {
  const kind = feature.kind;
  if (kind !== "hole" && kind !== "slot") return [];
  const params = feature.parameters ?? {};
  if ((params.axis ?? "z") !== "z") return [];
  const fid = feature.id ?? "";
  const tid = targetComponent.id ?? "";
  const dims = targetComponent.dimensions ?? {};
  const footprintKey = FOOTPRINT_DIM[targetComponent.kind];
  const depthKey = DEPTH_DIM[targetComponent.kind];
  const e: string[] = [];
  if (footprintKey && dims[footprintKey] != null) {
    const bound = dims[footprintKey];
    const size =
      kind === "hole"
        ? params.diameter
        : Math.max(params.length ?? 0, params.width ?? 0);
    if (size != null && size > bound)
      e.push(
        `feature ${fid} size exceeds target ${tid} ${footprintKey} (${size} > ${bound})`,
      );
  }
  const depth = params.depth;
  if (depthKey && typeof depth === "number" && dims[depthKey] != null) {
    const bound = dims[depthKey];
    if (depth > bound)
      e.push(
        `feature ${fid} depth exceeds target ${tid} ${depthKey} (${depth} > ${bound})`,
      );
  }
  return e;
}

// Shared bound for any composable-part feature parameter that must stay
// less than half of its target's smallest relevant dimension to avoid
// degenerate, self-intersecting geometry (a shell wall meeting itself, or a
// fillet/chamfer eating past the edge it started from) -- the same concern
// `simple_box`'s `wallThickness` gets in checkPart() below, just for a
// composable-part feature instead of a part-family parameter. Uses the same
// FOOTPRINT_DIM/DEPTH_DIM maps as featureFitErrors() above (so it's skipped
// for kinds without a clean footprint/depth split), even though the brepjs
// generator additionally restricts which (kind, face/edges) combinations it
// can actually build (see SHELL_SUPPORTED_FACES/FILLET_SUPPORTED_EDGES in
// brepjs.composable.ts) -- this check is about geometric validity, not
// generator support, so it stays broader. Returns null if within bounds or
// if the target's kind has no footprint/depth model to check against.
function boundedDimensionError(
  feature: any,
  targetComponent: any,
  value: number,
  label: string,
): string | null {
  const fid = feature.id ?? "";
  const tid = targetComponent.id ?? "";
  const dims = targetComponent.dimensions ?? {};
  const footprintKey = FOOTPRINT_DIM[targetComponent.kind];
  const depthKey = DEPTH_DIM[targetComponent.kind];
  const bounds = [footprintKey, depthKey]
    .map((k) => (k ? dims[k] : null))
    .filter((v): v is number => v != null);
  if (bounds.length === 0) return null;
  const bound = Math.min(...bounds) / 2;
  if (value >= bound)
    return `feature ${fid} ${label} must be less than half of target ${tid}'s smallest dimension (${value} >= ${bound})`;
  return null;
}
function shellFitErrors(feature: any, targetComponent: any): string[] {
  if (feature.kind !== "shell") return [];
  const thickness = (feature.parameters ?? {}).thickness;
  if (thickness == null) return [];
  const err = boundedDimensionError(
    feature,
    targetComponent,
    thickness,
    "thickness",
  );
  return err ? [err] : [];
}
function filletChamferFitErrors(feature: any, targetComponent: any): string[] {
  if (feature.kind !== "fillet" && feature.kind !== "chamfer") return [];
  const params = feature.parameters ?? {};
  const isFillet = feature.kind === "fillet";
  const value = isFillet ? params.radius : params.distance;
  if (value == null) return [];
  const err = boundedDimensionError(
    feature,
    targetComponent,
    value,
    isFillet ? "radius" : "distance",
  );
  return err ? [err] : [];
}
// Sanity-checks a text feature's "engrave" depth against its target's own
// depth dimension -- the same concern featureFitErrors() has for hole/slot
// depth, just using the full dimension as the bound (not halved the way
// boundedDimensionError() checks shell/fillet/chamfer): an engraved recess
// deeper than the target itself would cut all the way through, which -- for
// a decorative/labeling feature, unlike a deliberate through hole -- is
// almost certainly an authoring mistake rather than intent. "emboss" adds
// material outward instead, so it has no equivalent depth ceiling.
function textFitErrors(feature: any, targetComponent: any): string[] {
  if (feature.kind !== "text") return [];
  const params = feature.parameters ?? {};
  if ((params.mode ?? "emboss") !== "engrave") return [];
  const depth = params.depth;
  if (depth == null) return [];
  const fid = feature.id ?? "";
  const tid = targetComponent.id ?? "";
  const dims = targetComponent.dimensions ?? {};
  const depthKey = DEPTH_DIM[targetComponent.kind];
  if (!depthKey || dims[depthKey] == null) return [];
  const bound = dims[depthKey];
  if (depth >= bound)
    return [
      `feature ${fid} engrave depth must be less than target ${tid} ${depthKey} (${depth} >= ${bound})`,
    ];
  return [];
}
// Sanity-checks a component's own dimensions for internal consistency, for
// kinds whose dimensions have a documented relationship the schema itself
// can't express (a plain "number" property can't reference a sibling
// property). Without this, an inverted tube (innerDiameter >= outerDiameter)
// or torus (tubeDiameter >= outerDiameter, leaving no positive major radius)
// validates cleanly but produces a real-kernel-confirmed zero-volume,
// degenerate solid ("shape has no geometry") with no warning at all.
function componentDimensionErrors(component: any): string[] {
  const dims = component.dimensions ?? {};
  const cid = component.id ?? "";
  const e: string[] = [];
  if (
    component.kind === "tube" &&
    dims.innerDiameter != null &&
    dims.outerDiameter != null &&
    dims.innerDiameter >= dims.outerDiameter
  )
    e.push(
      `component ${cid} (tube) innerDiameter must be less than outerDiameter (${dims.innerDiameter} >= ${dims.outerDiameter})`,
    );
  if (
    component.kind === "torus" &&
    dims.tubeDiameter != null &&
    dims.outerDiameter != null &&
    dims.tubeDiameter >= dims.outerDiameter
  )
    e.push(
      `component ${cid} (torus) tubeDiameter must be less than outerDiameter (${dims.tubeDiameter} >= ${dims.outerDiameter})`,
    );
  if (component.kind === "swept_profile" && Array.isArray(dims.path)) {
    const path = dims.path;
    const [p0, p1] = path;
    if (p0 && p1 && (p0.x !== p1.x || p0.y !== p1.y || p0.z === p1.z))
      e.push(
        `component ${cid} (swept_profile) path's first two points must differ only in z (the first segment must run parallel to the Z axis, matching the profile's fixed orientation)`,
      );
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (a.x === b.x && a.y === b.y && a.z === b.z)
        e.push(
          `component ${cid} (swept_profile) path has two consecutive identical points at index ${i}`,
        );
    }
  }
  return e;
}
// Deliberately does NOT lean on the schema's `"format": "uri"` for
// well-formed-URL-ness: that keyword is a silent no-op in the Python
// validator (jsonschema's FormatChecker has no "uri" checker registered
// unless the optional `rfc3987` package is installed, which this project
// doesn't depend on -- confirmed, not assumed), the same pre-existing gap
// `supplierReference.url` already works around with its own manual check
// below. So this function is fully self-contained in both languages: it
// rejects a malformed URL itself, and additionally rejects a URL with a
// scheme that's syntactically fine but real-kernel-verified to never work
// at runtime -- `file://` is valid URI syntax, but Node's built-in
// `fetch()` (which brepjs's `loadFont()` calls directly) throws outright on
// it. Catching either at validation time saves a much more confusing
// failure later, deep inside a `loadFont()` rejection when the generated
// module actually runs.
// fontUrl is fetched at brepjs kernel runtime by loadFont() -> fetch() when the
// generated module loads. An unrestricted http(s) URL there is a server-side
// request forgery (SSRF) vector: an authored spec could point it at a cloud
// metadata endpoint or an internal host. So the URL is restricted to an inert
// `data:` URI (no network) or `https:` on a small allowlist of trusted public
// font hosts. Plain `http:` is rejected too (no cleartext, smaller surface).
// Extend ALLOWED_FONT_URL_HOSTS deliberately -- each host becomes reachable
// from inside the kernel run.
const ALLOWED_FONT_URL_HOSTS = new Set(["fonts.gstatic.com"]);
function textFontUrlErrors(feature: any): string[] {
  if (feature.kind !== "text") return [];
  const fontUrl = (feature.parameters ?? {}).fontUrl;
  if (!fontUrl) return [];
  const fid = feature.id ?? "";
  let url: URL;
  try {
    url = new URL(fontUrl);
  } catch {
    return [`feature ${fid} (text) fontUrl is not a valid URL: ${fontUrl}`];
  }
  if (url.protocol === "data:") return [];
  if (url.protocol === "https:") {
    if (!ALLOWED_FONT_URL_HOSTS.has(url.host))
      return [
        `feature ${fid} (text) fontUrl host "${url.host}" is not on the allowlist -- fontUrl is fetched at kernel runtime, so it must be a data: URI or https on an allowlisted font host (${[...ALLOWED_FONT_URL_HOSTS].join(", ")})`,
      ];
    return [];
  }
  return [
    `feature ${fid} (text) fontUrl must be a data: URI or an https:// URL on an allowlisted font host (got "${url.protocol}") -- http:// and other schemes are not permitted because loadFont() fetches this URL at runtime`,
  ];
}

// Component kinds a `thread` feature may target for each mode: "external"
// fuses a ridge onto an outer, cylindrical surface (a cylinder/boss's own
// `diameter`, or a tube's `outerDiameter`); "internal" cuts a ridge from an
// inner bore, which only a tube's own `innerDiameter` provides directly (a
// solid cylinder/boss has no bore of its own to thread -- author a `hole`
// feature and target that instead, exactly like counterbore/countersink
// already stack on a hole).
const THREAD_EXTERNAL_KINDS = new Set(["cylinder", "boss", "tube"]);
const THREAD_INTERNAL_KINDS = new Set(["tube"]);
// Sanity-checks a thread feature: `crest` (a flat-crest half-width) must be
// less than `toothHalfWidth` (the full tooth half-width at the root) for the
// same reason brepjs's own thread() docs state it -- a crest at or past the
// tooth's own root leaves no sloped flank at all, degenerating the profile.
// Also checks the target is actually threadable for the requested `mode`
// (see THREAD_EXTERNAL_KINDS/THREAD_INTERNAL_KINDS above) and, when the
// target's own axial dimension is known, that `height` doesn't exceed it --
// the same "feature must fit within its target" concern featureFitErrors()
// already has for hole/slot depth, just for thread's own `height` parameter
// and using DEPTH_DIM/a stacked hole's own `depth` as the bound instead.
function threadFeatureErrors(
  feature: any,
  componentsById: Map<string, any>,
  featuresById: Map<string, any>,
): string[] {
  if (feature.kind !== "thread") return [];
  const fid = feature.id ?? "";
  const params = feature.parameters ?? {};
  const e: string[] = [];
  if (
    params.crest != null &&
    params.toothHalfWidth != null &&
    params.crest >= params.toothHalfWidth
  )
    e.push(
      `feature ${fid} (thread) crest must be less than toothHalfWidth (${params.crest} >= ${params.toothHalfWidth})`,
    );
  const mode = params.mode ?? "external";
  const targetId = feature.target;
  const component = componentsById.get(targetId);
  const targetFeature = featuresById.get(targetId);
  let depthBound: number | null = null;
  let depthLabel = "";
  if (component) {
    const validKinds =
      mode === "external" ? THREAD_EXTERNAL_KINDS : THREAD_INTERNAL_KINDS;
    if (!validKinds.has(component.kind)) {
      e.push(
        `feature ${fid} (thread, ${mode}) target ${targetId} is a ${component.kind}, which has no ${mode === "external" ? "outer surface" : "inner bore"} to thread`,
      );
    } else {
      const depthKey = DEPTH_DIM[component.kind];
      if (depthKey && component.dimensions?.[depthKey] != null) {
        depthBound = component.dimensions[depthKey];
        depthLabel = `target ${targetId} ${depthKey}`;
      }
    }
  } else if (targetFeature) {
    if (mode !== "internal" || targetFeature.kind !== "hole") {
      e.push(
        `feature ${fid} (thread, ${mode}) target ${targetId} (a ${targetFeature.kind} feature) is not a valid thread target -- internal threads may target a "hole" feature or a "tube" component's inner bore; external threads may target a "cylinder"/"boss"/"tube" component`,
      );
    } else {
      const depth = targetFeature.parameters?.depth;
      if (typeof depth === "number") {
        depthBound = depth;
        depthLabel = `target ${targetId}'s hole depth`;
      }
    }
  }
  if (
    depthBound != null &&
    typeof params.height === "number" &&
    params.height > depthBound
  )
    e.push(
      `feature ${fid} (thread) height exceeds ${depthLabel} (${params.height} > ${depthBound})`,
    );
  return e;
}

// Resolves a `dimension` constraint's `left`/`right` operand to a number: a
// literal number passes through unchanged; a DimensionRef ({ref, key})
// looks up `key` in the referenced component's `dimensions` or feature's
// `parameters`. Deliberately doesn't resolve positions, patterns, or
// relations -- a constraint checks numbers the author already wrote down
// elsewhere in the spec, not anything the generator would need to resolve
// at generation time, so this stays entirely within semantic.ts's existing
// scope (dimension/parameter values only) instead of needing to duplicate
// brepjs.composable.ts's position-resolution engine, which only exists in
// the TypeScript generator, not here or in the Python package.
function resolveConstraintOperand(
  operand: any,
  componentsById: Map<string, any>,
  featuresById: Map<string, any>,
): { value: number } | { error: string } {
  if (typeof operand === "number") return { value: operand };
  const { ref, key } = operand ?? {};
  const component = componentsById.get(ref);
  const feature = featuresById.get(ref);
  if (!component && !feature)
    return { error: `references unknown component/feature: ${ref}` };
  const bag = component ? component.dimensions : feature.parameters;
  const value = bag?.[key];
  if (typeof value !== "number")
    return {
      error: `references non-numeric or missing ${component ? "dimension" : "parameter"} "${key}" on ${ref}`,
    };
  return { value };
}
const CONSTRAINT_OPERATORS: Record<string, (a: number, b: number) => boolean> =
  {
    "<": (a, b) => a < b,
    "<=": (a, b) => a <= b,
    ">": (a, b) => a > b,
    ">=": (a, b) => a >= b,
    "==": (a, b) => a === b,
    "!=": (a, b) => a !== b,
  };
// Checks one `dimension` constraint against the part's already-authored
// numbers (see resolveConstraintOperand()). Not a solver: both operands
// must already resolve to concrete values, the same way every other check
// in this file works against numbers the author already wrote down, rather
// than computing anything.
function dimensionConstraintErrors(
  constraint: any,
  index: number,
  componentsById: Map<string, any>,
  featuresById: Map<string, any>,
): string[] {
  if (constraint?.type !== "dimension") return [];
  const label = constraint.id ?? `#${index}`;
  const left = resolveConstraintOperand(
    constraint.left,
    componentsById,
    featuresById,
  );
  const right = resolveConstraintOperand(
    constraint.right,
    componentsById,
    featuresById,
  );
  const e: string[] = [];
  if ("error" in left) e.push(`constraint ${label} left ${left.error}`);
  if ("error" in right) e.push(`constraint ${label} right ${right.error}`);
  if (e.length > 0) return e;
  const leftValue = (left as { value: number }).value;
  const rightValue = (right as { value: number }).value;
  const margin = constraint.margin ?? 0;
  const rightWithMargin = rightValue + margin;
  const holds = CONSTRAINT_OPERATORS[constraint.operator](
    leftValue,
    rightWithMargin,
  );
  if (!holds) {
    const marginNote = margin ? ` + ${margin}` : "";
    e.push(
      `constraint ${label} failed: ${leftValue} ${constraint.operator} ${rightValue}${marginNote} is false`,
    );
  }
  return e;
}
// Kinds with no well-defined axis-aligned bounding box (see aabbExtents() in
// brepjs.composable.ts, whose switch falls through to `default: return
// null` for exactly these three) -- a `clearance` constraint referencing one
// has nothing to measure a gap against.
const NO_AABB_KINDS = new Set(["rib", "wedge", "swept_profile"]);
// Checks a `clearance` constraint's structural validity only: that `a`/`b`
// reference real, distinct components with well-defined geometry. Whether
// the constraint's `minDistance` actually holds needs each component's
// fully resolved world position (relations, rotation, group/pattern
// composition), which only the TypeScript brepjs generator can compute
// (see docs/composable-parts.md, "Constraints") -- this deliberately
// doesn't attempt that, staying within semantic validation's existing
// scope (the same principle dimensionConstraintErrors() above already
// follows for `dimension` constraints).
function clearanceConstraintErrors(
  constraint: any,
  index: number,
  componentsById: Map<string, any>,
): string[] {
  if (constraint?.type !== "clearance") return [];
  const label = constraint.id ?? `#${index}`;
  const e: string[] = [];
  const check = (ref: any, side: "a" | "b") => {
    const component = componentsById.get(ref);
    if (!component)
      e.push(
        `constraint ${label} ${side} references unknown component: ${ref}`,
      );
    else if (NO_AABB_KINDS.has(component.kind))
      e.push(
        `constraint ${label} ${side} references component ${ref} (kind "${component.kind}"), which has no well-defined bounding box to check a clearance against`,
      );
  };
  check(constraint.a, "a");
  check(constraint.b, "b");
  if (constraint.a === constraint.b)
    e.push(`constraint ${label} a and b must be different components`);
  return e;
}
function params(part: any) {
  return part?.parameters ?? {};
}
function checkPart(part: any, prefix = "part"): string[] {
  const e: string[] = [];
  const p = params(part);
  if (
    part?.type === "rounded_rectangular_plate" &&
    p.cornerRadius > Math.min(p.length, p.width) / 2
  )
    e.push(
      `${prefix}.parameters.cornerRadius exceeds half of min(length,width)`,
    );
  if (
    part?.type === "simple_box" &&
    p.wallThickness >= Math.min(p.outerLength, p.outerWidth) / 2
  )
    e.push(
      `${prefix}.parameters.wallThickness must be less than half of outer dimensions`,
    );
  if (
    part?.type === "round_spacer" &&
    p.innerDiameter != null &&
    p.innerDiameter >= p.outerDiameter
  )
    e.push(
      `${prefix}.parameters.innerDiameter must be less than outerDiameter`,
    );
  if (part?.type === "electronics_standoff") {
    if (p.holeDiameter >= p.outerDiameter)
      e.push(
        `${prefix}.parameters.holeDiameter must be less than outerDiameter`,
      );
    if ((p.baseDiameter == null) !== (p.baseHeight == null))
      e.push(
        `${prefix}.parameters.baseDiameter and baseHeight must be provided together`,
      );
    if (p.baseDiameter != null && p.baseDiameter < p.outerDiameter)
      e.push(
        `${prefix}.parameters.baseDiameter must be greater than or equal to outerDiameter`,
      );
  }
  const maxW = p.width ?? p.outerWidth ?? p.outerDiameter;
  for (const h of p.holes ?? []) {
    if (h.diameter > maxW)
      e.push(`${prefix}.parameters.holes diameter exceeds target width`);
  }
  return e;
}
export function validateSemantic(spec: any): string[] {
  const e: string[] = [];
  const checkHw = (items: any[] | undefined, label: string) => {
    e.push(
      ...dup(
        (items ?? []).map((h) => h.id).filter(Boolean),
        `${label} hardware`,
      ),
    );
    for (const h of items ?? []) {
      if (!Number.isInteger(h.quantity) || h.quantity < 1)
        e.push(`${label}.hardware quantity must be integer >= 1`);
      for (const r of h.supplierReferences ?? []) {
        if (!r.partNumber)
          e.push(`${label}.supplierReference partNumber is required`);
        if (r.url) {
          let parsed: URL | null = null;
          try {
            parsed = new URL(r.url);
          } catch {
            // leave parsed null; reported below
          }
          if (
            !parsed ||
            (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
            !parsed.host ||
            !r.url.includes("://")
          )
            e.push(`${label}.supplierReference url is invalid`);
        }
      }
    }
  };
  checkHw(spec?.hardware, "top-level");
  if (spec?.part) {
    if (spec.part.type === "composable_part") {
      e.push(...complexityErrors(spec.part));
      const components = spec.part.components ?? [];
      const groups = spec.part.groups ?? [];
      const componentIds = components.map((c: any) => c.id);
      const featureIds = (spec.part.features ?? [])
        .map((f: any) => f.id)
        .filter(Boolean);
      const groupIds = groups.map((g: any) => g.id);
      e.push(...dup(componentIds, "component"));
      e.push(...dup(featureIds, "feature"));
      e.push(...dup(groupIds, "group"));
      // A target/relation.target may reference a component, a feature (for
      // example a counterbore stacked on top of a hole), or a group. Those
      // three id spaces are checked for internal duplicates above, but target
      // resolution treats them as one combined namespace, so also reject an
      // id reused across categories (ambiguous which one a target
      // referencing it would mean).
      const componentIdSet = new Set<string>(componentIds);
      const featureIdSet = new Set<string>(featureIds);
      const groupIdSet = new Set<string>(groupIds);
      const crossCategoryDupes = new Set([
        ...[...componentIdSet].filter((id) => featureIdSet.has(id)),
        ...[...componentIdSet].filter((id) => groupIdSet.has(id)),
        ...[...featureIdSet].filter((id) => groupIdSet.has(id)),
      ]);
      for (const dupId of [...crossCategoryDupes].sort())
        e.push(`id used by more than one component/feature/group: ${dupId}`);
      const known = new Set([...componentIds, ...featureIds, ...groupIds]);
      const componentsById = new Map<string, any>(
        components.map((c: any) => [c.id, c]),
      );
      const featuresById = new Map<string, any>(
        (spec.part.features ?? []).map((f: any) => [f.id, f]),
      );
      const relationEdges = new Map<string, string[]>();
      const addRelationEdge = (from: string, to: string) => {
        const arr = relationEdges.get(from) ?? [];
        arr.push(to);
        relationEdges.set(from, arr);
      };
      // A relation anchors to a single point on its target's bounding box
      // (see docs/composable-parts.md), which is undefined for a patterned
      // entry: it has no single instance to anchor to. CSG (appliesTo,
      // feature target) is unaffected, since "the shape" of a patterned
      // entry -- the union of its instances -- is well-defined regardless of
      // anchor-point ambiguity.
      const patternedIds = new Set([
        ...components.filter((c: any) => c.pattern).map((c: any) => c.id),
        ...(spec.part.features ?? [])
          .filter((f: any) => f.pattern)
          .map((f: any) => f.id),
        ...groups.filter((g: any) => g.pattern).map((g: any) => g.id),
      ]);
      const checkRelationTarget = (
        ownerId: string,
        ownerLabel: string,
        relation: any,
      ) => {
        const t = relation?.target;
        if (!t) return;
        if (t === ownerId)
          e.push(
            `${ownerLabel} ${ownerId} relation target cannot reference itself`,
          );
        else if (!known.has(t))
          e.push(
            `${ownerLabel} ${ownerId} relation target does not exist: ${t}`,
          );
        else if (patternedIds.has(t)) {
          // A patterned target has no single instance to anchor to by
          // default -- but relation.targetInstance opts into anchoring to
          // one specific instance instead (see resolveOwn() in
          // brepjs.composable.ts). Only valid for a component/feature's own
          // pattern, not a group's (a group's pattern repeats the whole
          // sub-assembly as a rigid unit, a different anchor-resolution
          // shape not handled here), and must be in range for that
          // pattern's actual instance count.
          if (relation.targetInstance == null)
            e.push(
              `${ownerLabel} ${ownerId} relation target is a patterned component/feature and cannot be used as a positional anchor: ${t} (set relation.targetInstance to anchor to one specific instance)`,
            );
          else if (groupIdSet.has(t))
            e.push(
              `${ownerLabel} ${ownerId} relation targetInstance is not supported for a group target: ${t}`,
            );
          else {
            const targetNode = componentsById.get(t) ?? featuresById.get(t);
            const count = patternInstanceCount(targetNode?.pattern);
            if (relation.targetInstance >= count)
              e.push(
                `${ownerLabel} ${ownerId} relation targetInstance ${relation.targetInstance} is out of bounds for ${t}'s pattern (${count} instance(s))`,
              );
            else addRelationEdge(ownerId, t);
          }
        } else if (relation.targetInstance != null)
          e.push(
            `${ownerLabel} ${ownerId} relation targetInstance is only valid when target is patterned: ${t}`,
          );
        else addRelationEdge(ownerId, t);
      };
      for (const f of spec.part.features ?? []) {
        const fid = f.id ?? "";
        e.push(...textFontUrlErrors(f));
        e.push(...threadFeatureErrors(f, componentsById, featuresById));
        if (f.target) {
          if (f.target === fid)
            e.push(`feature ${fid} target cannot reference itself`);
          else if (!known.has(f.target))
            e.push(`feature ${fid} target does not exist: ${f.target}`);
          else {
            if (componentsById.has(f.target)) {
              e.push(...featureFitErrors(f, componentsById.get(f.target)));
              e.push(...shellFitErrors(f, componentsById.get(f.target)));
              e.push(
                ...filletChamferFitErrors(f, componentsById.get(f.target)),
              );
              e.push(...textFitErrors(f, componentsById.get(f.target)));
            }
            // A feature's `target` is a real dependency even without an
            // explicit `relation`: it's both the implicit position anchor
            // (see effectiveRelation() in brepjs.composable.ts) and, for the
            // generator, which component's solid the cut is scoped to. It's
            // deliberately allowed to reference a patterned component/feature
            // (unlike relation.target above), since CSG scoping doesn't have
            // the single-instance-anchor ambiguity a positional anchor does.
            // Add it as an edge for cycle detection regardless of whether
            // `relation` is also set, so a target-only cycle (two features
            // that `target` each other with no `relation`) is caught here
            // instead of stack-overflowing the generator's resolver.
            addRelationEdge(fid, f.target);
          }
        }
        checkRelationTarget(fid, "feature", f.relation);
      }
      for (const c of components) {
        checkRelationTarget(c.id, "component", c.relation);
        e.push(...componentDimensionErrors(c));
        for (const appliesId of c.appliesTo ?? []) {
          if (appliesId === c.id)
            e.push(`component ${c.id} appliesTo cannot reference itself`);
          else if (!componentIdSet.has(appliesId))
            e.push(
              `component ${c.id} appliesTo references unknown component: ${appliesId}`,
            );
        }
      }
      const memberTransformingGroups = new Map<string, string[]>();
      for (const g of groups) {
        const memberIds: string[] = g.memberIds ?? [];
        if (memberIds.includes(g.relation?.target))
          e.push(
            `group ${g.id} relation target is one of its own members: ${g.relation.target} would be re-positioned by a transform anchored on its own (pre-group) position`,
          );
        else checkRelationTarget(g.id, "group", g.relation);
        if (g.relation?.inheritRotation)
          e.push(
            `group ${g.id} relation may not set inheritRotation: only valid on a component or feature relation`,
          );
        for (const memberId of memberIds) {
          if (!componentIdSet.has(memberId))
            e.push(
              `group ${g.id} memberIds references unknown component: ${memberId}`,
            );
          else if (
            g.position != null ||
            g.rotation != null ||
            g.relation != null ||
            g.pattern != null
          ) {
            const owners = memberTransformingGroups.get(memberId) ?? [];
            owners.push(g.id);
            memberTransformingGroups.set(memberId, owners);
          }
        }
      }
      for (const [memberId, owningGroups] of memberTransformingGroups)
        if (owningGroups.length > 1)
          e.push(
            `component ${memberId} is a member of more than one group with its own position/rotation/relation/pattern: ${[...owningGroups].sort().join(", ")}`,
          );
      // A grouped component's world position depends on its transforming
      // group's own resolved transform (see worldPosition() in
      // brepjs.composable.ts), so that dependency is itself an edge for
      // cycle-detection purposes, in addition to each node's own `relation`.
      for (const [memberId, owningGroups] of memberTransformingGroups)
        for (const gid of owningGroups) addRelationEdge(memberId, gid);
      for (const cycle of relationCycles(relationEdges))
        e.push(`relation cycle detected: ${cycle.join(" -> ")}`);
      (spec.part.constraints ?? []).forEach((c: any, i: number) => {
        e.push(
          ...dimensionConstraintErrors(c, i, componentsById, featuresById),
        );
        e.push(...clearanceConstraintErrors(c, i, componentsById));
      });
    } else e.push(...checkPart(spec.part));
    checkHw(spec.part.hardware, "part");
  }
  if (spec?.project) {
    const partIds = (spec.project.parts ?? []).map((p: any) => p.id);
    const partSet = new Set(partIds);
    const hwIds = (spec.project.hardware ?? []).map((h: any) => h.id);
    const hwSet = new Set(hwIds);
    e.push(...dup(partIds, "project part"), ...dup(hwIds, "project hardware"));
    for (const r of spec.project.relationships ?? []) {
      if (r.partA && !partSet.has(r.partA))
        e.push(`relationship partA missing: ${r.partA}`);
      if (r.partB && !partSet.has(r.partB))
        e.push(`relationship partB missing: ${r.partB}`);
      if (r.hardware && !hwSet.has(r.hardware))
        e.push(`relationship hardware missing: ${r.hardware}`);
    }
    for (const p of spec.project.parts ?? [])
      if (p.spec)
        e.push(
          ...validateSemantic(p.spec).map((x) => `project.parts.${p.id}: ${x}`),
        );
    checkHw(spec.project.hardware, "project");
  }
  return e;
}
