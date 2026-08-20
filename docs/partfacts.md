# PartFacts

**PartFacts** are the kernel-measured, provenance-carrying facts about a solid
built from a printspec part. They are the comparable output of a geometry
kernel — the low-level OpenCascade (OCP/OCCT) build that engines run, or the
brepjs kernel used as a differential oracle.

The schema is published at
`https://schemas.invisra.ai/printspec/0.2.0/partfacts.schema.json`.

## Why PartFacts exist

printspec is a *format*, not an engine. A spec describes a part; a kernel
turns that spec into a solid. PartFacts are how two independent kernels (or two
builds of the same kernel) agree they produced the *same* part without ever
comparing geometry bytes:

- **OCCT is not bit-reproducible.** The same spec, kernel, and inputs can
  produce meshes/breps that differ byte-for-byte. So PartFacts are **never**
  compared by hashing geometry — they are compared by rounding each numeric
  fact to a shared tolerance (`tolerance.decimals`, default 6) and checking
  equality. OCCT's own bounding box carries an intrinsic ~`1e-7` gap that this
  rounding absorbs.
- **The kernel version is part of the correctness contract.** Every PartFacts
  payload records the exact `kernelVersion` and the `imageDigest` of the
  container the kernel ran in, alongside the `printspecVersion` and the
  `generator` + `generatorVersion` that produced it. Facts from different
  kernel builds are comparable, but their provenance is never lost.

## Shape

```json
{
  "printspecVersion": "0.2.0",
  "generator": "ocp",
  "generatorVersion": "0.1.0",
  "kernelVersion": "OCCT 7.9.3 (OCP 7.9.3.1)",
  "imageDigest": "sha256:...",
  "specHash": "sha256:...",
  "tolerance": { "decimals": 6 },
  "measurements": {
    "isValid": true,
    "volume": 6000.0,
    "surfaceArea": 2200.0,
    "centerOfMass": [5.0, 10.0, 15.0],
    "boundingBox": {
      "min": [0.0, 0.0, 0.0],
      "max": [10.0, 20.0, 30.0],
      "size": [10.0, 20.0, 30.0]
    },
    "topology": { "solids": 1, "shells": 1, "faces": 6, "edges": 12, "vertices": 8 }
  },
  "warnings": []
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `printspecVersion` | Schema version the source spec targets. |
| `generator` / `generatorVersion` | Which kernel/worker produced the facts, and its code version. |
| `kernelVersion` | Exact geometry kernel version string. |
| `imageDigest` | Digest of the container image the kernel ran in. |
| `specHash` | Optional hash of the normalized source spec (provenance, not geometry). |
| `tolerance.decimals` | Decimal places each float was rounded to before recording/comparison. |
| `measurements.isValid` | Kernel validity check (`BRepCheck_Analyzer` for OCP). |
| `measurements.volume` / `surfaceArea` | mm³ / mm². |
| `measurements.centerOfMass` | `[x, y, z]` in mm. |
| `measurements.boundingBox` | Axis-aligned `min` / `max` / `size` in mm. |
| `measurements.topology` | Unique sub-shape counts (mapped, not explorer-counted). |
| `warnings` | Non-fatal build/measure warnings. |

## Producing PartFacts

Schemas are open; engines are closed. printspec ships the *schema* for
PartFacts; the kernel service that actually builds solids and emits conforming
PartFacts lives in a separate, engine repository (it depends on a CAD kernel,
which published printspec packages must never do).
