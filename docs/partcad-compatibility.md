# PartCAD compatibility

printspec describes parametric geometry intent. PartCAD can package generated CAD source, outputs, supplier files, BOMs, and assembly notes. printspec is not a replacement for PartCAD.

Future bundle layout:

```text
project/
├─ printspec.json
├─ partcad.yaml
├─ cadquery/model.py
├─ openscad/model.scad
├─ outputs/model.step
├─ outputs/model.stl
├─ outputs/model.3mf
├─ preview.png
├─ bom.csv
└─ README.md
```

## Bundle stub

Bundle export can generate an experimental `partcad.yaml` with `--partcad` / `includePartCad`. The stub references generated CadQuery source files only and does not claim full PartCAD support.
