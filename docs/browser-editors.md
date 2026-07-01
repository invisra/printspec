# Browser editors

A browser parameter editor can read the JSON Schema, render fields from titles/descriptions/defaults/minimums/maximums/examples/enums, validate user input locally, display warnings, serialize specs to URLs or saved JSON, and send specs to a backend worker for CAD source generation or preview/export. This repo does not build a browser editor.

## Browser/editor form metadata

Printspec schemas now include `x-printspec-*` browser-editor metadata for parameter ordering, grouping, units, controls, steps, priorities, examples, and documentation-only warnings. See `docs/form-metadata.md` for the convention plus TypeScript, Python, and CLI usage. This metadata helps tools render forms; it is not a web app and does not execute CAD.

