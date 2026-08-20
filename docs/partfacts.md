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

A PartFacts document has four required sections plus two optional ones.

### `provenance` (required)

Where the facts came from, so a result is reproducible and auditable:

- `printspecVersion` — the document-schema version of the executed spec.
- `generator` — the printspec generator that emitted the kernel program
  (`{ name, version }`, e.g. `brepjs` or `cadquery`).
- `kernel` — the geometry kernel that ran and measured (`{ name, version }`,
  e.g. `OpenCascade`).
- `imageDigest` — the content-addressed digest (`sha256:…`) of the container
  image that executed the kernel, pinning the exact runtime.
- `specDigest`, `generatedAt` — optional: digest of the exact spec, and a
  timestamp.

### `topology` (required)

B-rep topology and validity from a BRepCheck-style analysis: `solidCount`,
`shellCount`, `faceCount`, `edgeCount`, `vertexCount`, the `closed`, `manifold`,
and `valid` flags, an optional `genus`, and an optional itemized `checks` array.
The flags are the gate everything else hangs on — mass properties and the feature
inventory are only trustworthy when the shape is `closed` and `valid`.

### `massProperties` (required)

Computed under uniform unit density (so these are shape properties, not material
weights): `volume`, `surfaceArea`, `centerOfMass`, the axis-aligned `boundingBox`
(`min`/`max`/`size`), and an optional `inertiaTensor` (six independent
components, taken about the center of mass unless a `referencePoint` says
otherwise).

### `featureInventory` (optional)

A classified inventory of boundary faces so downstream checks can find holes and
walls without a kernel:

- `cylindricalFaces` — the wall of each hole, bore, or pin: `axis`, `radius`,
  axial `length`, `through`/blind, and optional `convex` handedness. This is how
  a rule locates holes and checks their diameters.
- `planarFaces` — each flat wall, floor, or mounting face: outward `normal` and
  `area`, with optional `centroid`/`pointOnPlane`.
- `otherFaceCount` — faces that are neither (conical, spherical, spline, …).
  `cylindricalFaces + planarFaces + otherFaceCount` should equal
  `topology.faceCount`.

### `extensions` (optional)

A forward-compatible, namespaced map for later tiers (manufacturability metrics,
thin-wall maps, draft analysis, mesh statistics, …). Consumers **must ignore**
keys they do not recognize, and adding a key here is an additive change that
never requires a new PartFacts version.

## Validation

Both packages validate PartFacts **offline** against the bundled schema, exactly
like `validatePrintSpec` (see [validation](./validation.md)). There is no
semantic layer for PartFacts in `0.1.0`; validation is structural only. The
PartFacts schema is self-contained (no `$ref` into the document schemas), so it
validates with a standalone validator and never touches the network.

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

## Relationship to real-kernel verification

The developer-only, opt-in scripts under `scripts/` (`verify:brepjs-real-kernel`,
`verify:cadquery-real-kernel`, and the `brep verify` inspection in
[generators](./generators.md)) already measure exactly these quantities — valid
solids, volumes, bounding boxes, centers of mass, solid-count manifold checks —
against a real OCCT kernel. PartFacts is the standardized, versioned serialization
of that same class of measurement, so a production engine can emit it and any
consumer can validate and read it. Those scripts remain opt-in and are never run
in CI; defining PartFacts adds no kernel dependency to the published packages.
