# PartFacts

PartFacts is the canonical, machine-readable record of what a printspec part
*actually is* once a real CAD kernel has built it. Where a printspec document is
the **input** (a parametric description of a part), a PartFacts document is the
**output**: the measured topology, mass properties, and feature inventory the
kernel reports after executing that spec.

PartFacts lets downstream tooling reason about a built part — "does it have the
two M3 through-holes the design called for?", "is the shell watertight?", "what
does it weigh?" — without re-running geometry. The measurement is done once, by
the engine that owns the kernel; everything downstream reads the facts.

> **Schemas are open; engines are closed.** This repository defines and
> validates the *shape* of PartFacts. It does **not** execute any CAD kernel and
> takes on no kernel dependency. The engine that measures a real part and emits
> PartFacts lives in a different repository (see
> [design-principles](./design-principles.md) and [safety](./safety.md)).

## Schema location and versioning

- Source of truth: [`schemas/partfacts/0.1.0/partfacts.schema.json`](../schemas/partfacts/0.1.0/partfacts.schema.json)
- `$id`: `https://schemas.invisra.ai/printspec/partfacts/0.1.0/partfacts.schema.json`
- Hosted index: `https://schemas.invisra.ai/printspec/partfacts/`

PartFacts is **versioned independently** of the printspec document schema. The
document schema currently sits at `0.2.0`; PartFacts starts at `0.1.0`. They
move on separate tracks — an additive PartFacts revision does not bump the
document schema, and vice-versa — so PartFacts lives under its own
`printspec/partfacts/<version>/` hosted namespace rather than the document
schema's `printspec/<version>/` path. (This also keeps PartFacts `0.1.0` clear
of the document schema's own, already-released and immutable, `0.1.0`
directory.) Independent version tracks are an established pattern here; see
[hosted-schemas](./hosted-schemas.md).

Per the version-immutability rule, a breaking change publishes a new
`printspec/partfacts/<version>/` directory; the old one stays served. Purely
additive fields can also go in [`extensions`](#extensions) without any version
bump at all.

## Units and precision

PartFacts uses the same coordinate and unit conventions as printspec: millimeters
(`mm`), with X as length, Y as width/depth, Z as height/thickness (see
[units-and-coordinates](./units-and-coordinates.md)). The unit system is also
recorded explicitly in the top-level `units` object so a consumer never has to
assume it. Derived units follow: area is `mm²`, volume is `mm³`, and the inertia
tensor is `mm⁵` (a second moment of *volume* under uniform unit density).

Every numeric field in the schema documents both its **unit** and a **precision
note** describing how the value was measured and how far it should be trusted.
Analytic quantities read from a surface (a cylinder's radius, a face's normal)
are exact to kernel tolerance (~`1e-7 mm`); integrated quantities (volume,
surface area, inertia) are exact for prismatic geometry and carry a small
numerical margin for curved geometry. Read the field descriptions in the schema
for the specifics — they are the authority.

## Document shape

A PartFacts document has four required sections — `partfactsVersion`, `units`,
`provenance`, `topology` — plus `massProperties` (required unless the shape is
invalid; see below) and the optional `solids`, `featureInventory`, and
`extensions`.

A part is **one or more solids**. `topology` and `massProperties` describe the
whole result **aggregated over every solid** (counts sum, volume/area/inertia
sum, the bounding box encloses all solids, the center of mass is the
volume-weighted centroid). When disjoint solids must be told apart — a
`composable_part` can legitimately produce several — the optional `solids` array
carries each solid's own `topology` and `massProperties`.

### `units` (required)

`{ "length": "mm" }`, optionally `"angle": "deg"`. Fixed for `0.1.0` but recorded
explicitly and **required** so a consumer never assumes. (JSON Schema `default`
is annotation-only and never applied, so a default would be a silent trap — the
field is required instead.)

### `provenance` (required)

Where the facts came from, so a result is reproducible and auditable:

- `printspecVersion` — the document-schema version of the executed spec.
- `generator` — the printspec generator that emitted the kernel program
  (`{ name, version }`, e.g. `brepjs` or `cadquery`).
- `kernel` — the geometry kernel that ran and measured (`{ name, version }`,
  e.g. `OpenCascade`).
- `imageDigest` — the content-addressed digest (`sha256:…`) of the container
  image that executed the kernel, pinning the exact runtime.
- `specDigest`, `generatedAt` — optional: digest of the exact spec (see the
  [RFC 8785 requirement](#5-spec-digest-canonicalization) below), and a
  timestamp.

### `topology` (required)

B-rep topology and validity from a BRepCheck-style analysis: `solidCount`,
`shellCount`, `faceCount`, `edgeCount`, `vertexCount`, the `closed`, `manifold`,
and `valid` flags, an optional `genus`, an optional `maxShapeTolerance` health
metric, and a `checks` array (**required when `valid` is `false`** so a repair
loop has something to act on). The flags are the gate everything else hangs on —
mass properties and the feature inventory are only trustworthy when the shape is
`closed` and `valid`.

`maxShapeTolerance` (mm, optional) is the largest per-subshape OCCT tolerance in
the shape. These balloon after boolean operations, so a shape can be `valid:true`
yet geometrically *mushy*; a typical clean value is `~1e-7`, and a large value
(e.g. `~1e-2`) flags a shape that will tessellate and compare poorly. The
threshold at which a consumer should treat a shape as degraded is a **TODO** (see
the summary of open tolerance decisions).

### `massProperties` (required unless invalid)

Computed under uniform unit density (so these are shape properties, not material
weights): `volume`, `surfaceArea`, `centerOfMass`, the axis-aligned `boundingBox`
(`min`/`max`/`size`), and an optional `inertiaTensor` (six independent
components, taken about the center of mass unless a `referencePoint` says
otherwise). At the top level every field aggregates over all solids.

`massProperties` is required **whenever `topology.valid` is true**. When
`topology.valid` is `false` the shape is geometrically unsound — volume and
inertia are undefined over a non-closed or self-intersecting shape — so the
engine MAY omit the section rather than emit meaningless numbers. Consumers
should already gate on `topology.valid` before trusting these figures.

### `solids` (optional)

One entry per solid, each with its own `topology` and (when that solid is valid)
`massProperties`. An **unordered set** — match by geometry, not index. The
top-level aggregate remains the source of truth and must agree (counts sum, mass
properties sum).

### `featureInventory` (optional)

A classified inventory of boundary faces so downstream checks can find holes and
walls without a kernel:

- `cylindricalFaces` — the wall of each hole, bore, or pin, located by its two
  axial endpoints `start`/`end` (with `axis` = `normalize(end - start)` and
  `length` = `|end - start|` as derived conveniences), its `radius`, the
  **required** `convex` handedness (material outside the cylinder = a pin;
  material around a void = a hole), and an **optional** `through` flag. This is
  the **source of truth** for cylindrical geometry.
- `planarFaces` — each flat wall, floor, or mounting face, located by its outward
  `normal` and a signed plane `offset` (the plane is `{ p : dot(normal, p) =
  offset }`), with its `area` and an optional `centroid`.
- `holes` — an optional, **derived** grouping of co-axial cylindrical faces into
  logical features. One physical hole often yields several faces (a bore through
  two walls with a gap, a counterbore's two radii, a cylinder split by an
  intersecting feature); each `holes` entry merges the faces sharing a
  `featureId` into one feature with a `through` verdict for the whole run and an
  **ordered** `segments` array (`{radius, start, end, faceIds}` from `start` to
  `end`, so a counterbore is representable). `holes` MUST agree with
  `cylindricalFaces`, which stays authoritative.
- `otherFaceCount` — faces that are neither (conical, spherical, spline, …).
  `cylindricalFaces + planarFaces + otherFaceCount` should equal
  `topology.faceCount`.

Why `convex` is required and `through` is not: `convex` distinguishes a 4 mm hole
from a 4 mm pin — the single most load-bearing bit for a geometric check — and is
reliably computable, whereas `through` needs surrounding topology and can be
genuinely undetermined for a single face. A consumer **MUST treat an absent
`through` as unknown, never as `false`**; the grouped `holes` entry is where a
reliable through-verdict for a split bore lives.

### `extensions` (optional)

A forward-compatible, namespaced map for later tiers (manufacturability metrics,
thin-wall maps, draft analysis, mesh statistics, …). Consumers **must ignore**
keys they do not recognize, and adding a key here is an additive change that
never requires a new PartFacts version.

## Engine requirements

Several correctness properties cannot be expressed in JSON Schema and are
**normative obligations on the engine** (the closed-source service that produces
PartFacts). They use RFC 2119 keywords. printspec cannot enforce these — a
document can be schema-valid and still violate them — so they live here.

### 1. Cylindrical endpoints from parametric bounds

`start` and `end` on a `CylindricalFace` (and the derived `axis`/`length`) MUST
be computed from the **face's own parametric bounds**, not from the cylindrical
surface's stored origin. In OCCT a cylindrical surface's origin has no defined
relationship to the face that lies on it: two kernels report different origins
for the same hole and both are correct. Deriving endpoints from the surface
origin therefore makes `start`/`end` non-comparable across kernels. `axis` MUST
equal `normalize(end - start)` and `length` MUST equal `|end - start|` within
tolerance.

### 2. Co-axial grouping for logical holes

When emitting `featureInventory.holes`, the engine MUST group cylindrical faces
by **co-axiality within tolerance — parallel axes AND collinear axis lines** —
not by radius equality. Radius equality alone wrongly merges two unrelated 3 mm
holes, and misses a counterbore (whose two segments have different radii but one
axis). Faces grouped into one hole share a `featureId`, and the hole's `segments`
are ordered along the axis.

### 3. Outward normals must honor `TopAbs_REVERSED`

When computing a `PlanarFace` (or cylindrical) `normal`, the engine MUST account
for the face's `TopAbs_REVERSED` orientation in the shell. A face's geometric
surface normal points in a fixed direction; whether that is the *outward* normal
of the solid depends on the face orientation flag. Ignoring it **inverts roughly
half of all normals** — and, because it inverts them symmetrically, still passes
smoke tests on symmetric parts, so it is easy to ship undetected.

### 4. Arrays are unordered; ids are not portable

`cylindricalFaces`, `planarFaces`, `holes`, `solids`, and `topology.checks` are
**unordered sets**. A consumer comparing two documents (e.g. the same part from
two kernels) MUST match elements **by geometry within tolerance** — axis + radius
+ axial extent for cylinders; normal + offset + area for planes; `name` for
checks — never by array index. (`Hole.segments` is the one exception: it is
**ordered** along the axis.)

Every `id` and `featureId` is a **within-document reference only**. It is NOT
stable across kernels or across kernel versions and MUST NOT be used for
cross-kernel matching. `faceIds` inside a hole segment likewise reference this
document's own faces only.

### 5. Spec-digest canonicalization

`provenance.specDigest`, when present, MUST be the SHA-256 of the printspec
document's **RFC 8785 (JSON Canonicalization Scheme)** canonical form, formatted
`"sha256:<64 hex>"`. "Canonicalized JSON" is otherwise underspecified — two
implementations produce different bytes for the same logical document, silently
breaking cache keys and provenance claims. RFC 8785 pins key ordering and number
formatting so independent implementations agree. Ready-made libraries exist on
both sides: [`canonicalize`](https://www.npmjs.com/package/canonicalize) (npm)
and [`rfc8785`](https://pypi.org/project/rfc8785/) (PyPI). These are engine-side
dependencies only; the printspec packages take on neither.

## Validation

Both packages validate PartFacts **offline** against the bundled schema, exactly
like `validatePrintSpec` (see [validation](./validation.md)). There is no
semantic layer for PartFacts in `0.1.0`; validation is structural only. The
PartFacts schema is self-contained (no `$ref` into the document schemas), so it
validates with a standalone validator and never touches the network.

**Version dispatch.** A loader MUST read `partfactsVersion` from the raw JSON and
dispatch to the matching schema **before** validating, so an unsupported version
produces a clear "unsupported PartFacts version" error instead of a confusing
`const` mismatch buried in structural errors. `validatePartFacts` /
`validate_partfacts` do this for you: they read `partfactsVersion`, return the
clear error for a version they do not bundle, and otherwise validate against the
matching schema. The bundled set is exposed as `supportedPartFactsVersions`
(TypeScript) / `SUPPORTED_PARTFACTS_VERSIONS` (Python).

TypeScript (Node and browser entrypoints both export it):

```ts
import { validatePartFacts, partFactsSchemaVersion } from "@invisra/printspec";
// or: import { validatePartFacts } from "@invisra/printspec/browser";

const result = validatePartFacts(facts); // { valid: boolean, errors: string[] }
```

Python:

```py
from printspec import validate_partfacts

result = validate_partfacts(facts)  # {"valid": bool, "errors": list[str]}
```

A minimal valid document:

```json
{
  "partfactsVersion": "0.1.0",
  "units": { "length": "mm" },
  "provenance": {
    "printspecVersion": "0.2.0",
    "generator": { "name": "cadquery", "version": "2.4.0" },
    "kernel": { "name": "OpenCascade", "version": "7.8.1" }
  },
  "topology": {
    "solidCount": 1, "shellCount": 1,
    "faceCount": 6, "edgeCount": 12, "vertexCount": 8,
    "closed": true, "manifold": true, "valid": true
  },
  "massProperties": {
    "volume": 1000, "surfaceArea": 600,
    "centerOfMass": { "x": 0, "y": 0, "z": 5 },
    "boundingBox": { "min": { "x": -5, "y": -5, "z": 0 }, "max": { "x": 5, "y": 5, "z": 10 } }
  }
}
```

Worked examples, including a fuller document with a feature inventory and inertia
tensor, live under
[`tests/fixtures/partfacts/`](../tests/fixtures/partfacts/).

## Open tolerance decisions (TODO)

The schema deliberately does not invent numeric tolerances; these are left for a
follow-up once real fixtures exist:

- **Co-axiality tolerance** for grouping cylindrical faces into `holes`
  (parallel-axis angular tolerance and collinearity distance).
- **Consistency tolerance** for `axis` ≟ `normalize(end - start)`, `length` ≟
  `|end - start|`, and `boundingBox.size` ≟ `max - min`.
- **Geometry-match tolerance** for cross-kernel/differential comparison (axis +
  radius + extent for cylinders; normal + offset + area for planes).
- **`maxShapeTolerance` threshold** above which a `valid:true` shape should be
  treated as degraded.

## Relationship to real-kernel verification

The developer-only, opt-in scripts under `scripts/` (`verify:brepjs-real-kernel`,
`verify:cadquery-real-kernel`, and the `brep verify` inspection in
[generators](./generators.md)) already measure exactly these quantities — valid
solids, volumes, bounding boxes, centers of mass, solid-count manifold checks —
against a real OCCT kernel. PartFacts is the standardized, versioned serialization
of that same class of measurement, so a production engine can emit it and any
consumer can validate and read it. Those scripts remain opt-in and are never run
in CI; defining PartFacts adds no kernel dependency to the published packages.
