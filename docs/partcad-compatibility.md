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
