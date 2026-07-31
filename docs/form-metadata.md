# Browser/editor form metadata

Printspec schemas include lightweight JSON Schema extension metadata for browser editors, AI-assisted tools, and developer utilities that want to render parameter forms. This metadata is descriptive only: printspec does not ship a UI, does not execute CAD, and does not evaluate warning-condition expressions.

## Extension fields

Parameter objects may define `x-printspec-ui` with an `order` array and `groups` array. Field schemas may define `x-printspec-unit`, `x-printspec-control`, `x-printspec-step`, `x-printspec-priority`, `x-printspec-help`, and enum labels with `x-printspec-enumLabels`. Optional `x-printspec-warnings` entries contain documentation-string conditions and messages.

Unknown JSON Schema keywords are allowed by Draft 2020-12 validators, so these extension fields do not change validation semantics. Printspec instance schemas still use `additionalProperties: false` where appropriate and do not permit arbitrary `x-printspec-*` data in user specs unless a schema explicitly allows it.

## Helpers

TypeScript:

```ts
import {getPartFamilyFormMetadata, listPartFamilies} from '@invisra/printspec';

console.log(listPartFamilies());
console.log(getPartFamilyFormMetadata('rounded_rectangular_plate'));
```

Python:

```py
from printspec import get_part_family_form_metadata, list_part_families

print(list_part_families())
print(get_part_family_form_metadata("rounded_rectangular_plate"))
```

CLI:

```sh
printspec form-metadata rounded_rectangular_plate --pretty
printspec list-part-families --pretty
```

A form renderer can use `fields` for controls, units, defaults, examples, and required flags, then use `groups` to place controls into sections.
