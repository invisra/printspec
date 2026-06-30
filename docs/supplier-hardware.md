# Supplier hardware and BOMs

Hardware items can appear at the top level, on a part, on a project, or inside inline project part specs. BOM helpers extract those items, normalize quantities, and can emit Markdown, CSV, or supplier-grouped order lists.

Supplier references may include `supplier`, `partNumber`, `url`, and `description`. URLs are validated structurally where schema validation is available. Normalization maps common McMaster spellings to `mcmaster`.

printspec does not scrape supplier websites, check inventory, create carts, place orders, or integrate with McMaster-Carr automation. Supplier order lists are plain text summaries for human review.
