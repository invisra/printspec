from urllib.parse import urlparse


def _is_integer_number(value):
    """Python parity for JS's Number.isInteger(): unlike a bare
    isinstance(value, int) check, this also accepts a JSON number that
    happened to parse as a Python float but has no fractional part (5.0),
    since JSON Schema's "type": "integer" -- and JS's own Number type, which
    has no separate int/float -- both accept that value as an integer.
    Rejects bool (a Python int subclass) for the same reason
    Number.isInteger(true) is false in JS: a boolean isn't a number."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return value.is_integer()
    return False


def _js_number_str(n):
    """Python parity for JS's template-literal number formatting: a
    whole-valued float prints without a trailing ".0" (3, not 3.0), matching
    how the equivalent TypeScript check's `${n}` would print the same JSON
    number (which, in JS, has no separate int/float representation at all).
    Used anywhere a feature/component numeric value is interpolated into an
    error message, so authoring the same spec with e.g. `5.0` instead of `5`
    in JSON doesn't change the message text between the two languages."""
    return str(int(n)) if n == int(n) else str(n)


def _dups(vals, label):
    seen = set()
    out = []
    for v in vals:
        if v in seen:
            out.append(f"duplicate {label} id: {v}")
        seen.add(v)
    return out


def _pattern_instance_count(pattern):
    """Total instance count a pattern produces, purely from its own
    authored counts -- no position resolution needed, so (unlike anything
    that would need brepjs.composable.ts's resolver, which has no Python
    equivalent) this is safe to compute in shared semantic validation.
    Matches patternOffsets() in brepjs.composable.ts's own per-type
    instance counts exactly."""
    if not pattern:
        return 1
    if pattern.get("type") == "rectangular":
        return pattern["countX"] * pattern["countY"]
    return pattern["count"]


def _relation_cycles(edges):
    """Find cycles in a directed graph where a node may have more than one
    outgoing edge -- a component/feature/group has at most one `relation`
    edge, but a component may *also* have an implicit edge to its
    transforming group (its world position depends on that group's own
    resolved transform), so the graph isn't a strict one-edge-per-node
    functional graph. `edges` maps a node id to a list of target ids."""
    state = {}
    cycles = []
    path = []

    def visit(node):
        state[node] = 1
        path.append(node)
        for nxt in edges.get(node, []):
            s = state.get(nxt)
            if s is None:
                visit(nxt)
            elif s == 1:
                idx = path.index(nxt)
                cycles.append(path[idx:] + [nxt])
        path.pop()
        state[node] = 2

    for start in edges:
        if start not in state:
            visit(start)
    return cycles


# Maps a component kind to the dimension key used for hole/slot footprint (X/Y
# in-plane) and depth (Z) sanity checks. Kinds without a clean footprint/depth
# split (rib, wedge) are intentionally omitted, so they are not checked.
# ellipsoid is intentionally omitted too: its X and Y extents can differ
# (lengthX vs lengthY), so it has no single "footprint" number a hole/slot/
# shell/fillet/chamfer bound check could correctly compare against without
# silently ignoring whichever axis is smaller.
_FOOTPRINT_DIM = {
    "box": "width",
    "rounded_box": "width",
    "plate": "width",
    "tab": "width",
    "cylinder": "diameter",
    "boss": "diameter",
    "tube": "outerDiameter",
    "sphere": "diameter",
    "torus": "outerDiameter",
}
_DEPTH_DIM = {
    "box": "height",
    "rounded_box": "height",
    "plate": "thickness",
    "tab": "thickness",
    "cylinder": "height",
    "boss": "height",
    "tube": "height",
    "sphere": "diameter",
    "torus": "tubeDiameter",
}


def _feature_fit_errors(feature, target_component):
    """Sanity-check a hole/slot feature's size against its target component's
    dimensions; only for the default (z) axis, since the footprint/depth
    mapping is ambiguous for x/y axes and unmapped kinds (rib, wedge)."""
    kind = feature.get("kind")
    if kind not in ("hole", "slot"):
        return []
    params = feature.get("parameters") or {}
    if params.get("axis", "z") != "z":
        return []
    fid = feature.get("id", "")
    tid = target_component.get("id", "")
    dims = target_component.get("dimensions") or {}
    footprint_key = _FOOTPRINT_DIM.get(target_component.get("kind"))
    depth_key = _DEPTH_DIM.get(target_component.get("kind"))
    e = []
    if footprint_key and dims.get(footprint_key) is not None:
        bound = dims[footprint_key]
        size = (
            params.get("diameter")
            if kind == "hole"
            else max(params.get("length", 0), params.get("width", 0))
        )
        if size is not None and size > bound:
            e.append(
                f"feature {fid} size exceeds target {tid} {footprint_key} "
                f"({_js_number_str(size)} > {_js_number_str(bound)})"
            )
    depth = params.get("depth")
    if depth_key and isinstance(depth, (int, float)) and dims.get(depth_key) is not None:
        bound = dims[depth_key]
        if depth > bound:
            e.append(
                f"feature {fid} depth exceeds target {tid} {depth_key} "
                f"({_js_number_str(depth)} > {_js_number_str(bound)})"
            )
    return e


def _bounded_dimension_error(feature, target_component, value, label):
    """Shared bound for any composable-part feature parameter that must stay
    less than half of its target's smallest relevant dimension to avoid
    degenerate, self-intersecting geometry (a shell wall meeting itself, or
    a fillet/chamfer eating past the edge it started from). Uses the same
    _FOOTPRINT_DIM/_DEPTH_DIM maps as _feature_fit_errors() above (skipped
    for kinds without a clean footprint/depth split), even though the
    brepjs generator additionally restricts which (kind, face/edges)
    combinations it can actually build -- this check is about geometric
    validity, not generator support, so it stays broader. Returns None if
    within bounds or if the target's kind has no footprint/depth model."""
    fid = feature.get("id", "")
    tid = target_component.get("id", "")
    dims = target_component.get("dimensions") or {}
    footprint_key = _FOOTPRINT_DIM.get(target_component.get("kind"))
    depth_key = _DEPTH_DIM.get(target_component.get("kind"))
    bounds = [dims[k] for k in (footprint_key, depth_key) if k and dims.get(k) is not None]
    if not bounds:
        return None
    bound = min(bounds) / 2
    if value >= bound:
        return (
            f"feature {fid} {label} must be less than half of target {tid}'s "
            f"smallest dimension ({_js_number_str(value)} >= {_js_number_str(bound)})"
        )
    return None


def _shell_fit_errors(feature, target_component):
    """Sanity-check a shell feature's wall thickness; see
    _bounded_dimension_error()."""
    if feature.get("kind") != "shell":
        return []
    thickness = (feature.get("parameters") or {}).get("thickness")
    if thickness is None:
        return []
    err = _bounded_dimension_error(feature, target_component, thickness, "thickness")
    return [err] if err else []


def _fillet_chamfer_fit_errors(feature, target_component):
    """Sanity-check a fillet/chamfer feature's radius/distance; see
    _bounded_dimension_error()."""
    kind = feature.get("kind")
    if kind not in ("fillet", "chamfer"):
        return []
    params = feature.get("parameters") or {}
    is_fillet = kind == "fillet"
    value = params.get("radius") if is_fillet else params.get("distance")
    if value is None:
        return []
    err = _bounded_dimension_error(
        feature, target_component, value, "radius" if is_fillet else "distance"
    )
    return [err] if err else []


def _text_fit_errors(feature, target_component):
    """Sanity-check a text feature's "engrave" depth against its target's
    own depth dimension -- the same concern _feature_fit_errors() has for
    hole/slot depth, just using the full dimension as the bound (not halved
    the way _bounded_dimension_error() checks shell/fillet/chamfer)."""
    if feature.get("kind") != "text":
        return []
    params = feature.get("parameters") or {}
    if params.get("mode", "emboss") != "engrave":
        return []
    depth = params.get("depth")
    if depth is None:
        return []
    fid = feature.get("id", "")
    tid = target_component.get("id", "")
    dims = target_component.get("dimensions") or {}
    depth_key = _DEPTH_DIM.get(target_component.get("kind"))
    if not depth_key or dims.get(depth_key) is None:
        return []
    bound = dims[depth_key]
    if depth >= bound:
        return [
            f"feature {fid} engrave depth must be less than target {tid} {depth_key} "
            f"({depth} >= {bound})"
        ]
    return []


def _component_dimension_errors(component):
    """Sanity-checks a component's own dimensions for internal consistency,
    for kinds whose dimensions have a documented relationship the schema
    itself can't express (a plain "number" property can't reference a
    sibling property). Without this, an inverted tube (innerDiameter >=
    outerDiameter) or torus (tubeDiameter >= outerDiameter, leaving no
    positive major radius) validates cleanly but produces a real-kernel-
    confirmed zero-volume, degenerate solid ("shape has no geometry") with
    no warning at all."""
    dims = component.get("dimensions") or {}
    cid = component.get("id", "")
    e = []
    if (
        component.get("kind") == "tube"
        and dims.get("innerDiameter") is not None
        and dims.get("outerDiameter") is not None
        and dims["innerDiameter"] >= dims["outerDiameter"]
    ):
        e.append(
            f"component {cid} (tube) innerDiameter must be less than outerDiameter "
            f"({dims['innerDiameter']} >= {dims['outerDiameter']})"
        )
    if (
        component.get("kind") == "torus"
        and dims.get("tubeDiameter") is not None
        and dims.get("outerDiameter") is not None
        and dims["tubeDiameter"] >= dims["outerDiameter"]
    ):
        e.append(
            f"component {cid} (torus) tubeDiameter must be less than outerDiameter "
            f"({dims['tubeDiameter']} >= {dims['outerDiameter']})"
        )
    if component.get("kind") == "swept_profile" and isinstance(dims.get("path"), list):
        path = dims["path"]
        if len(path) >= 2:
            p0, p1 = path[0], path[1]
            if p0.get("x") != p1.get("x") or p0.get("y") != p1.get("y") or p0.get("z") == p1.get("z"):
                e.append(
                    f"component {cid} (swept_profile) path's first two points must differ only in z "
                    f"(the first segment must run parallel to the Z axis, matching the profile's fixed orientation)"
                )
        for i in range(len(path) - 1):
            a, b = path[i], path[i + 1]
            if a.get("x") == b.get("x") and a.get("y") == b.get("y") and a.get("z") == b.get("z"):
                e.append(
                    f"component {cid} (swept_profile) path has two consecutive identical points at index {i}"
                )
    return e


_ALLOWED_FONT_URL_SCHEMES = {"http", "https", "data"}


def _text_font_url_errors(feature):
    """Deliberately does NOT lean on the schema's "format": "uri" for
    well-formed-URL-ness: that keyword is a silent no-op in this validator
    (jsonschema's FormatChecker has no "uri" checker registered unless the
    optional rfc3987 package is installed, which this project doesn't
    depend on -- confirmed, not assumed), the same pre-existing gap
    supplierReference.url already works around with its own manual check
    elsewhere in this file. So this function is fully self-contained: it
    rejects a malformed URL itself, and additionally rejects a URL with a
    scheme that's syntactically fine but real-kernel-verified to never work
    at runtime -- file:// is valid URI syntax, but Node's built-in fetch()
    (which brepjs's loadFont() calls directly) throws outright on it."""
    if feature.get("kind") != "text":
        return []
    font_url = (feature.get("parameters") or {}).get("fontUrl")
    if not font_url:
        return []
    fid = feature.get("id", "")
    try:
        parsed = urlparse(font_url)
        scheme = parsed.scheme
    except ValueError:
        scheme = ""
    # urlparse(), unlike JS's new URL(), doesn't require a host for http(s)
    # -- "http://" parses cleanly with an empty netloc -- so an empty host
    # is rejected here explicitly for parity with the TypeScript check
    # (new URL("http://") throws outright). data: URIs legitimately have no
    # host and are unaffected by this check.
    if not scheme or (scheme in ("http", "https") and not parsed.netloc):
        return [f"feature {fid} (text) fontUrl is not a valid URL: {font_url}"]
    if scheme not in _ALLOWED_FONT_URL_SCHEMES:
        return [
            f'feature {fid} (text) fontUrl must be an http(s):// URL or a data: URI (got "{scheme}:") '
            f"-- brepjs's loadFont() (via fetch()) can't resolve other schemes in Node, most notably file://"
        ]
    return []


# Component kinds a `thread` feature may target for each mode: "external"
# fuses a ridge onto an outer, cylindrical surface (a cylinder/boss's own
# diameter, or a tube's outerDiameter); "internal" cuts a ridge from an inner
# bore, which only a tube's own innerDiameter provides directly (a solid
# cylinder/boss has no bore of its own to thread -- author a `hole` feature
# and target that instead, exactly like counterbore/countersink already
# stack on a hole).
_THREAD_EXTERNAL_KINDS = {"cylinder", "boss", "tube"}
_THREAD_INTERNAL_KINDS = {"tube"}


def _thread_feature_errors(feature, components_by_id, features_by_id):
    """Sanity-checks a thread feature: `crest` (a flat-crest half-width) must
    be less than `toothHalfWidth` (the full tooth half-width at the root)
    for the same reason brepjs's own thread() docs state it -- a crest at or
    past the tooth's own root leaves no sloped flank at all, degenerating
    the profile. Also checks the target is actually threadable for the
    requested `mode` (see _THREAD_EXTERNAL_KINDS/_THREAD_INTERNAL_KINDS
    above) and, when the target's own axial dimension is known, that
    `height` doesn't exceed it -- the same "feature must fit within its
    target" concern _feature_fit_errors() already has for hole/slot depth,
    just for thread's own `height` parameter and using _DEPTH_DIM/a stacked
    hole's own `depth` as the bound instead."""
    if feature.get("kind") != "thread":
        return []
    fid = feature.get("id", "")
    params = feature.get("parameters") or {}
    e = []
    crest = params.get("crest")
    tooth_half_width = params.get("toothHalfWidth")
    if crest is not None and tooth_half_width is not None and crest >= tooth_half_width:
        e.append(
            f"feature {fid} (thread) crest must be less than toothHalfWidth ({crest} >= {tooth_half_width})"
        )
    mode = params.get("mode", "external")
    target_id = feature.get("target")
    component = components_by_id.get(target_id)
    target_feature = features_by_id.get(target_id)
    depth_bound = None
    depth_label = ""
    if component is not None:
        valid_kinds = _THREAD_EXTERNAL_KINDS if mode == "external" else _THREAD_INTERNAL_KINDS
        if component.get("kind") not in valid_kinds:
            surface = "outer surface" if mode == "external" else "inner bore"
            e.append(
                f"feature {fid} (thread, {mode}) target {target_id} is a {component.get('kind')}, "
                f"which has no {surface} to thread"
            )
        else:
            depth_key = _DEPTH_DIM.get(component.get("kind"))
            dims = component.get("dimensions") or {}
            if depth_key and dims.get(depth_key) is not None:
                depth_bound = dims[depth_key]
                depth_label = f"target {target_id} {depth_key}"
    elif target_feature is not None:
        if mode != "internal" or target_feature.get("kind") != "hole":
            e.append(
                f"feature {fid} (thread, {mode}) target {target_id} (a {target_feature.get('kind')} feature) "
                f'is not a valid thread target -- internal threads may target a "hole" feature or a "tube" '
                f'component\'s inner bore; external threads may target a "cylinder"/"boss"/"tube" component'
            )
        else:
            depth = (target_feature.get("parameters") or {}).get("depth")
            if isinstance(depth, (int, float)):
                depth_bound = depth
                depth_label = f"target {target_id}'s hole depth"
    if depth_bound is not None and isinstance(params.get("height"), (int, float)) and params["height"] > depth_bound:
        e.append(f"feature {fid} (thread) height exceeds {depth_label} ({params['height']} > {depth_bound})")
    return e


def _resolve_constraint_operand(operand, components_by_id, features_by_id):
    """Resolves a `dimension` constraint's `left`/`right` operand to a
    number: a literal number passes through unchanged; a DimensionRef
    ({ref, key}) looks up `key` in the referenced component's `dimensions`
    or feature's `parameters`. Deliberately doesn't resolve positions,
    patterns, or relations -- a constraint checks numbers the author
    already wrote down elsewhere in the spec, not anything a generator
    would need to resolve at generation time, so this stays entirely
    within this module's existing scope (dimension/parameter values only)
    instead of needing a position-resolution engine, which only exists in
    the TypeScript generator (brepjs.composable.ts), not here.

    Returns a dict with either a "value" key or an "error" key."""
    if isinstance(operand, (int, float)) and not isinstance(operand, bool):
        return {"value": operand}
    operand = operand or {}
    ref = operand.get("ref")
    key = operand.get("key")
    component = components_by_id.get(ref)
    feature = features_by_id.get(ref)
    if component is None and feature is None:
        return {"error": f"references unknown component/feature: {ref}"}
    bag = component.get("dimensions") if component is not None else feature.get("parameters")
    value = (bag or {}).get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        kind = "dimension" if component is not None else "parameter"
        return {"error": f'references non-numeric or missing {kind} "{key}" on {ref}'}
    return {"value": value}


_CONSTRAINT_OPERATORS = {
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


def _dimension_constraint_errors(constraint, index, components_by_id, features_by_id):
    """Checks one `dimension` constraint against the part's already-
    authored numbers (see _resolve_constraint_operand()). Not a solver:
    both operands must already resolve to concrete values, the same way
    every other check in this file works against numbers the author
    already wrote down, rather than computing anything."""
    if (constraint or {}).get("type") != "dimension":
        return []
    label = constraint.get("id") or f"#{index}"
    left = _resolve_constraint_operand(constraint.get("left"), components_by_id, features_by_id)
    right = _resolve_constraint_operand(constraint.get("right"), components_by_id, features_by_id)
    e = []
    if "error" in left:
        e.append(f"constraint {label} left {left['error']}")
    if "error" in right:
        e.append(f"constraint {label} right {right['error']}")
    if e:
        return e
    left_value = left["value"]
    right_value = right["value"]
    margin = constraint.get("margin") or 0
    right_with_margin = right_value + margin
    holds = _CONSTRAINT_OPERATORS[constraint.get("operator")](left_value, right_with_margin)
    if not holds:
        margin_note = f" + {margin}" if margin else ""
        e.append(
            f"constraint {label} failed: {left_value} {constraint.get('operator')} "
            f"{right_value}{margin_note} is false"
        )
    return e


# Kinds with no well-defined axis-aligned bounding box (see aabbExtents() in
# brepjs.composable.ts, whose switch falls through to `default: return null`
# for exactly these three) -- a `clearance` constraint referencing one has
# nothing to measure a gap against.
_NO_AABB_KINDS = {"rib", "wedge", "swept_profile"}


def _clearance_constraint_errors(constraint, index, components_by_id):
    """Checks a `clearance` constraint's structural validity only: that
    `a`/`b` reference real, distinct components with well-defined geometry.
    Whether the constraint's `minDistance` actually holds needs each
    component's fully resolved world position (relations, rotation,
    group/pattern composition), which only the TypeScript brepjs generator
    can compute (see docs/composable-parts.md, "Constraints") -- this
    deliberately doesn't attempt that, staying within semantic validation's
    existing scope (the same principle _dimension_constraint_errors() above
    already follows for `dimension` constraints)."""
    if (constraint or {}).get("type") != "clearance":
        return []
    label = constraint.get("id") or f"#{index}"
    e = []

    def check(ref, side):
        component = components_by_id.get(ref)
        if component is None:
            e.append(f"constraint {label} {side} references unknown component: {ref}")
        elif component.get("kind") in _NO_AABB_KINDS:
            e.append(
                f"constraint {label} {side} references component {ref} "
                f"(kind \"{component.get('kind')}\"), which has no well-defined bounding box "
                f"to check a clearance against"
            )

    check(constraint.get("a"), "a")
    check(constraint.get("b"), "b")
    if constraint.get("a") == constraint.get("b"):
        e.append(f"constraint {label} a and b must be different components")
    return e


def _part(part, prefix="part"):
    e = []
    p = part.get("parameters") or {}
    if (
        part.get("type") == "rounded_rectangular_plate"
        and p.get("cornerRadius", 0) > min(p.get("length", 0), p.get("width", 0)) / 2
    ):
        e.append(f"{prefix}.parameters.cornerRadius exceeds half of min(length,width)")
    if (
        part.get("type") == "simple_box"
        and p.get("wallThickness", 0) >= min(p.get("outerLength", 0), p.get("outerWidth", 0)) / 2
    ):
        e.append(f"{prefix}.parameters.wallThickness must be less than half of outer dimensions")
    if (
        part.get("type") == "round_spacer"
        and p.get("innerDiameter") is not None
        and p.get("innerDiameter") >= p.get("outerDiameter", 0)
    ):
        e.append(f"{prefix}.parameters.innerDiameter must be less than outerDiameter")
    if part.get("type") == "electronics_standoff":
        if p.get("holeDiameter", 0) >= p.get("outerDiameter", 0):
            e.append(f"{prefix}.parameters.holeDiameter must be less than outerDiameter")
        if (p.get("baseDiameter") is None) != (p.get("baseHeight") is None):
            e.append(f"{prefix}.parameters.baseDiameter and baseHeight must be provided together")
        if p.get("baseDiameter") is not None and p.get("baseDiameter") < p.get("outerDiameter", 0):
            e.append(
                f"{prefix}.parameters.baseDiameter must be greater than or equal to outerDiameter"
            )
    maxw = p.get("width") or p.get("outerWidth") or p.get("outerDiameter")
    for h in p.get("holes") or []:
        if maxw and h.get("diameter", 0) > maxw:
            e.append(f"{prefix}.parameters.holes diameter exceeds target width")
    return e


def validate_semantic(spec):
    e = []

    def hw(items, label):
        e.extend(_dups([h.get("id") for h in items or [] if h.get("id")], f"{label} hardware"))
        for h in items or []:
            if not _is_integer_number(h.get("quantity")) or h.get("quantity") < 1:
                e.append(f"{label}.hardware quantity must be integer >= 1")
            for r in h.get("supplierReferences") or []:
                if not r.get("partNumber"):
                    e.append(f"{label}.supplierReference partNumber is required")
                if r.get("url"):
                    try:
                        parsed = urlparse(str(r["url"]))
                    except ValueError:
                        parsed = None
                    if (
                        not parsed
                        or parsed.scheme not in ("http", "https")
                        or not parsed.netloc
                        or "://" not in str(r["url"])
                    ):
                        e.append(f"{label}.supplierReference url is invalid")

    hw(spec.get("hardware"), "top-level")
    part = spec.get("part")
    if part:
        if part.get("type") == "composable_part":
            components = part.get("components") or []
            groups = part.get("groups") or []
            component_ids = [c.get("id") for c in components]
            feature_ids = [f.get("id") for f in part.get("features") or [] if f.get("id")]
            group_ids = [g.get("id") for g in groups]
            e.extend(_dups(component_ids, "component"))
            e.extend(_dups(feature_ids, "feature"))
            e.extend(_dups(group_ids, "group"))
            # A target/relation.target may reference a component, a feature (for
            # example a counterbore stacked on top of a hole), or a group. Those
            # three id spaces are checked for internal duplicates above, but
            # target resolution treats them as one combined namespace, so also
            # reject an id reused across categories (ambiguous which one a
            # target referencing it would mean).
            component_id_set = set(component_ids)
            feature_id_set = set(feature_ids)
            group_id_set = set(group_ids)
            for dup_id in sorted(
                (component_id_set & feature_id_set)
                | (component_id_set & group_id_set)
                | (feature_id_set & group_id_set)
            ):
                e.append(f"id used by more than one component/feature/group: {dup_id}")
            known = component_id_set | feature_id_set | group_id_set
            components_by_id = {c.get("id"): c for c in components}
            features_by_id = {f.get("id"): f for f in part.get("features") or []}
            relation_edges = {}

            def _add_relation_edge(from_id, to_id):
                relation_edges.setdefault(from_id, []).append(to_id)

            # A relation anchors to a single point on its target's bounding box
            # (see docs/composable-parts.md), which is undefined for a
            # patterned entry: it has no single instance to anchor to. CSG
            # (appliesTo, feature target) is unaffected, since "the shape" of
            # a patterned entry -- the union of its instances -- is
            # well-defined regardless of anchor-point ambiguity.
            patterned_ids = (
                {c.get("id") for c in components if c.get("pattern")}
                | {f.get("id") for f in part.get("features") or [] if f.get("pattern")}
                | {g.get("id") for g in groups if g.get("pattern")}
            )

            def check_relation_target(owner_id, owner_label, rel):
                rel = rel or {}
                t = rel.get("target")
                if not t:
                    return
                if t == owner_id:
                    e.append(f"{owner_label} {owner_id} relation target cannot reference itself")
                elif t not in known:
                    e.append(f"{owner_label} {owner_id} relation target does not exist: {t}")
                elif t in patterned_ids:
                    # A patterned target has no single instance to anchor to
                    # by default -- but relation.targetInstance opts into
                    # anchoring to one specific instance instead (see
                    # resolveOwn() in brepjs.composable.ts). Only valid for a
                    # component/feature's own pattern, not a group's (a
                    # group's pattern repeats the whole sub-assembly as a
                    # rigid unit, a different anchor-resolution shape not
                    # handled here), and must be in range for that pattern's
                    # actual instance count.
                    target_instance = rel.get("targetInstance")
                    if target_instance is None:
                        e.append(
                            f"{owner_label} {owner_id} relation target is a patterned component/feature "
                            f"and cannot be used as a positional anchor: {t} (set relation.targetInstance "
                            f"to anchor to one specific instance)"
                        )
                    elif t in group_id_set:
                        e.append(
                            f"{owner_label} {owner_id} relation targetInstance is not supported for a "
                            f"group target: {t}"
                        )
                    else:
                        target_node = components_by_id.get(t) or features_by_id.get(t)
                        count = _pattern_instance_count((target_node or {}).get("pattern"))
                        if target_instance >= count:
                            e.append(
                                f"{owner_label} {owner_id} relation targetInstance {target_instance} is "
                                f"out of bounds for {t}'s pattern ({count} instance(s))"
                            )
                        else:
                            _add_relation_edge(owner_id, t)
                elif rel.get("targetInstance") is not None:
                    e.append(
                        f"{owner_label} {owner_id} relation targetInstance is only valid when target is "
                        f"patterned: {t}"
                    )
                else:
                    _add_relation_edge(owner_id, t)

            for f in part.get("features") or []:
                fid = f.get("id", "")
                e.extend(_text_font_url_errors(f))
                e.extend(_thread_feature_errors(f, components_by_id, features_by_id))
                target = f.get("target")
                if target:
                    if target == fid:
                        e.append(f"feature {fid} target cannot reference itself")
                    elif target not in known:
                        e.append(f"feature {fid} target does not exist: {target}")
                    else:
                        if target in components_by_id:
                            e.extend(_feature_fit_errors(f, components_by_id[target]))
                            e.extend(_shell_fit_errors(f, components_by_id[target]))
                            e.extend(_fillet_chamfer_fit_errors(f, components_by_id[target]))
                            e.extend(_text_fit_errors(f, components_by_id[target]))
                        # A feature's `target` is a real dependency even
                        # without an explicit `relation`: it's both the
                        # implicit position anchor and, for the generator,
                        # which component's solid the cut is scoped to.
                        # Deliberately allowed to reference a patterned
                        # component/feature (unlike relation.target), since
                        # CSG scoping doesn't have the single-instance-anchor
                        # ambiguity a positional anchor does. Add it as an
                        # edge for cycle detection regardless of whether
                        # `relation` is also set, so a target-only cycle
                        # (two features that `target` each other with no
                        # `relation`) is caught here instead of crashing the
                        # generator's resolver.
                        _add_relation_edge(fid, target)
                check_relation_target(fid, "feature", f.get("relation"))
            for c in components:
                cid = c.get("id")
                check_relation_target(cid, "component", c.get("relation"))
                e.extend(_component_dimension_errors(c))
                for applies_id in c.get("appliesTo") or []:
                    if applies_id == cid:
                        e.append(f"component {cid} appliesTo cannot reference itself")
                    elif applies_id not in component_id_set:
                        e.append(
                            f"component {cid} appliesTo references unknown component: {applies_id}"
                        )
            member_transforming_groups = {}
            for g in groups:
                gid = g.get("id")
                member_ids = g.get("memberIds") or []
                rel = g.get("relation") or {}
                if rel.get("target") in member_ids:
                    e.append(
                        f"group {gid} relation target is one of its own members: "
                        f"{rel.get('target')} would be re-positioned by a transform anchored on "
                        f"its own (pre-group) position"
                    )
                else:
                    check_relation_target(gid, "group", g.get("relation"))
                if rel.get("inheritRotation"):
                    e.append(
                        f"group {gid} relation may not set inheritRotation: only valid on a "
                        f"component or feature relation"
                    )
                for member_id in member_ids:
                    if member_id not in component_id_set:
                        e.append(f"group {gid} memberIds references unknown component: {member_id}")
                    elif (
                        g.get("position") is not None
                        or g.get("rotation") is not None
                        or rel
                        or g.get("pattern") is not None
                    ):
                        member_transforming_groups.setdefault(member_id, []).append(gid)
            for member_id, owning_groups in member_transforming_groups.items():
                if len(owning_groups) > 1:
                    e.append(
                        f"component {member_id} is a member of more than one group with its own "
                        f"position/rotation/relation/pattern: {', '.join(sorted(owning_groups))}"
                    )
            # A grouped component's world position depends on its transforming
            # group's own resolved transform, so that dependency is itself an
            # edge for cycle-detection purposes, in addition to each node's
            # own `relation`.
            for member_id, owning_groups in member_transforming_groups.items():
                for gid in owning_groups:
                    _add_relation_edge(member_id, gid)
            for cycle in _relation_cycles(relation_edges):
                e.append(f"relation cycle detected: {' -> '.join(cycle)}")
            for i, c in enumerate(part.get("constraints") or []):
                e.extend(_dimension_constraint_errors(c, i, components_by_id, features_by_id))
                e.extend(_clearance_constraint_errors(c, i, components_by_id))
        else:
            e.extend(_part(part))
        hw(part.get("hardware"), "part")
    proj = spec.get("project")
    if proj:
        part_ids = [p.get("id") for p in proj.get("parts") or []]
        hw_ids = [h.get("id") for h in proj.get("hardware") or []]
        e.extend(_dups(part_ids, "project part"))
        e.extend(_dups(hw_ids, "project hardware"))
        ps = set(part_ids)
        hs = set(hw_ids)
        for r in proj.get("relationships") or []:
            if r.get("partA") and r.get("partA") not in ps:
                e.append(f"relationship partA missing: {r.get('partA')}")
            if r.get("partB") and r.get("partB") not in ps:
                e.append(f"relationship partB missing: {r.get('partB')}")
            if r.get("hardware") and r.get("hardware") not in hs:
                e.append(f"relationship hardware missing: {r.get('hardware')}")
        for p in proj.get("parts") or []:
            if p.get("spec"):
                e.extend(
                    [f"project.parts.{p.get('id')}: {x}" for x in validate_semantic(p["spec"])]
                )
        hw(proj.get("hardware"), "project")
    return e
