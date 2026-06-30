# Generators

The v0.1 generators produce source code only. They do not execute OpenSCAD, CadQuery, filesystem exports, subprocesses, or CAD runtimes in tests.

Supported part families are currently `rounded_rectangular_plate` and `spacer_block` for both OpenSCAD and CadQuery.

APIs:

```ts
generateOpenScad(spec)
generateCadQuery(spec)
```

```py
generate_openscad(spec)
generate_cadquery(spec)
```

Each returns `{ supported, code, message?, warnings? }`. Generators validate first; invalid specs return `supported: false` and empty code. Generated CadQuery defines a final `part` variable and intentionally omits export commands. Generated CAD must be reviewed before manufacturing.
