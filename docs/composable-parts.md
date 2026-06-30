# Composable parts

Composable parts are experimental in v0.1. They provide a constrained assembly of simple primitives and features; they are not a full CAD language.

Supported component kinds include `box`, `rounded_box`, `cylinder`, `tube`, `plate`, `tab`, `boss`, `rib`, and `wedge`. Component operations are `add` and `subtract`.

Supported feature kinds include `hole`, `slot`, `counterbore`, `countersink`, `fillet`, `chamfer`, and `text`. Semantic validation checks that feature targets refer to known component IDs where practical.

Supported relation names include `absolute`, `on_top_of`, `attached_to_face`, `centered_on`, `aligned_with`, `offset_from`, and `mirrored_from`. Relation solving is intentionally limited; generators may ignore unsupported composable structures.
