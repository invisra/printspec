import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import _WrappedReferencingError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from .semantic import validate_semantic

_SCHEMA_BASE_URI = "https://schemas.invisra.ai/printspec/0.2.0/"


def _schema_dir() -> Path:
    """Locate local schemas without network access.

    Installed wheels and editable installs should use package-local schemas in
    ``printspec/schemas`` first. Those package data files are synchronized from
    the repository-level ``schemas/`` source of truth by ``npm run sync:schemas``.
    Source checkouts can still fall back to the root ``schemas/`` directory.
    """
    packaged = Path(__file__).resolve().parent / "schemas"
    if packaged.is_dir():
        return packaged
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "schemas"
        if candidate.is_dir():
            return candidate
    raise RuntimeError("Unable to locate local printspec schemas directory")


def _load_schemas() -> dict[str, dict]:
    schemas: dict[str, dict] = {}
    for path in sorted(_schema_dir().glob("*.schema.json")):
        schemas[path.name] = json.loads(path.read_text(encoding="utf8"))
    return schemas


SCHEMAS = _load_schemas()


def _build_registry(schemas: dict[str, dict]) -> Registry:
    registry = Registry()
    for filename, schema in schemas.items():
        resource = Resource.from_contents(schema, default_specification=DRAFT202012)
        aliases = {filename, f"{_SCHEMA_BASE_URI}{filename}"}
        if schema.get("$id"):
            aliases.add(schema["$id"])
        for uri in aliases:
            registry = registry.with_resource(uri, resource)
    return registry


_REGISTRY = _build_registry(SCHEMAS)
_FORMAT_CHECKER = FormatChecker()


def _format_error(error) -> str:
    path = "/" + "/".join(str(part) for part in error.path)
    return f"{path}: {error.message}"


def _iter_errors(validator, data, schema_name: str):
    try:
        return sorted(validator.iter_errors(data), key=lambda e: list(e.path))
    except _WrappedReferencingError as exc:
        raise RuntimeError(
            f"Unable to resolve local JSON Schema reference for {schema_name}: {exc}"
        ) from exc


def _validate(schema_name: str, data, semantic: bool = False):
    if schema_name not in SCHEMAS:
        raise RuntimeError(f"Missing local schema: {schema_name}")
    validator = Draft202012Validator(
        SCHEMAS[schema_name], registry=_REGISTRY, format_checker=_FORMAT_CHECKER
    )
    errors = [_format_error(error) for error in _iter_errors(validator, data, schema_name)]
    if not errors and semantic:
        errors.extend(validate_semantic(data))
    return {"valid": not errors, "errors": errors}


def _type_to_schema_file(schemas: dict) -> dict:
    """Maps a discriminated part ``type`` value (for example
    "composable_part" or "rounded_rectangular_plate") to the schema file
    that defines it. Every part-family schema and composable-part.schema.json
    each declare a literal ``properties.type.const``. Excludes
    project.schema.json, whose own ``type: "project"`` const belongs to a
    different field (the top-level ``project``, not ``part``) and would
    otherwise misleadingly match a ``part.type`` of "project"."""
    mapping = {}
    for filename, schema in schemas.items():
        if filename == "project.schema.json":
            continue
        type_const = (schema.get("properties") or {}).get("type", {}).get("const")
        if isinstance(type_const, str):
            mapping[type_const] = filename
    return mapping


_TYPE_TO_SCHEMA_FILE = _type_to_schema_file(SCHEMAS)
_narrowed_validators: dict = {}


def _narrowed_family_validator(part_type: str):
    """See _type_to_schema_file() above: narrows part-family.schema.json's
    oneOf-over-13-types down to just the one schema file `part_type` names,
    when recognized, instead of the noisy every-branch-failed error output
    jsonschema's oneOf gives for an otherwise-recognizable part with some
    other mistake in it (a single unhelpful "is not valid under any of the
    given schemas" message, with the actually-relevant sub-error buried in
    that exception's own, unprinted ``.context``)."""
    cached = _narrowed_validators.get(("family", part_type))
    if cached is not None:
        return cached
    schema_file = _TYPE_TO_SCHEMA_FILE.get(part_type)
    if not schema_file or schema_file == "composable-part.schema.json":
        return None
    validator = Draft202012Validator(
        SCHEMAS[schema_file], registry=_REGISTRY, format_checker=_FORMAT_CHECKER
    )
    _narrowed_validators[("family", part_type)] = validator
    return validator


def _narrowed_printspec_validator(part_type: str):
    """Same idea as _narrowed_family_validator() above, but for
    printspec.schema.json as a whole (its `part` property is the oneOf,
    over both part-family types and composable_part)."""
    cached = _narrowed_validators.get(("printspec", part_type))
    if cached is not None:
        return cached
    schema_file = _TYPE_TO_SCHEMA_FILE.get(part_type)
    if not schema_file:
        return None
    base = SCHEMAS["printspec.schema.json"]
    variant = dict(base)
    variant["properties"] = {**base["properties"], "part": {"$ref": schema_file}}
    variant.pop("$id", None)
    validator = Draft202012Validator(variant, registry=_REGISTRY, format_checker=_FORMAT_CHECKER)
    _narrowed_validators[("printspec", part_type)] = validator
    return validator


def validate_part_family_spec(part):
    part_type = part.get("type") if isinstance(part, dict) else None
    if isinstance(part_type, str):
        narrowed = _narrowed_family_validator(part_type)
        if narrowed is not None:
            errors = [
                _format_error(error)
                for error in _iter_errors(narrowed, part, "part-family.schema.json")
            ]
            return {"valid": not errors, "errors": errors}
    return _validate("part-family.schema.json", part)


def validate_composable_part_spec(part):
    return _validate("composable-part.schema.json", part)


def validate_project_spec(project):
    return _validate("project.schema.json", project)


_PARTFACTS_NAME = "partfacts"
_PARTFACTS_SCHEMA_FILE = "partfacts.schema.json"


def _partfacts_schema_root() -> Path:
    """Locate the bundled PartFacts schema tree without network access.

    PartFacts is an independently versioned output-artifact schema living under
    ``schemas/partfacts/<version>/`` (not the flat, monolithically versioned
    printspec-document schema set), so it is loaded separately from
    :data:`SCHEMAS`. Prefers the package-local copy synchronized by
    ``npm run sync:schemas``; source checkouts fall back to the repository-level
    ``schemas/`` directory.
    """
    packaged = Path(__file__).resolve().parent / "schemas" / _PARTFACTS_NAME
    if packaged.is_dir():
        return packaged
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "schemas" / _PARTFACTS_NAME
        if candidate.is_dir():
            return candidate
    raise RuntimeError("Unable to locate local PartFacts schema directory")


def _load_partfacts_schemas() -> dict[str, dict]:
    root = _partfacts_schema_root()
    schemas: dict[str, dict] = {}
    for version_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        schema_file = version_dir / _PARTFACTS_SCHEMA_FILE
        if schema_file.is_file():
            schemas[version_dir.name] = json.loads(schema_file.read_text(encoding="utf8"))
    if not schemas:
        raise RuntimeError("No bundled PartFacts schema versions found")
    return schemas


PARTFACTS_SCHEMAS = _load_partfacts_schemas()
# Latest bundled version (versions are semver-ish; the last sorted key is newest).
PARTFACTS_SCHEMA_VERSION = sorted(PARTFACTS_SCHEMAS, key=lambda v: [int(n) for n in v.split(".")])[
    -1
]
PARTFACTS_SCHEMA = PARTFACTS_SCHEMAS[PARTFACTS_SCHEMA_VERSION]
SUPPORTED_PARTFACTS_VERSIONS = sorted(
    PARTFACTS_SCHEMAS, key=lambda v: [int(n) for n in v.split(".")]
)

# Each PartFacts schema validates with its own dedicated validator. The schemas
# are self-contained (no ``$ref`` to the document schemas), so no shared
# registry is needed and validation stays offline.
_PARTFACTS_VALIDATORS = {
    version: Draft202012Validator(schema, format_checker=_FORMAT_CHECKER)
    for version, schema in PARTFACTS_SCHEMAS.items()
}


def validate_partfacts(facts):
    """Validate a PartFacts document (the canonical output of executing a
    printspec on a real CAD kernel) against the bundled PartFacts JSON Schema,
    offline. Mirrors :func:`validate_printspec`'s result shape; there is no
    semantic layer for PartFacts in 0.1.0.

    The document's ``partfactsVersion`` is read from the raw object and
    dispatched to the matching bundled schema BEFORE validation, so an
    unsupported version yields a clear "unsupported PartFacts version" error
    instead of a confusing ``const`` mismatch. A document with no
    ``partfactsVersion`` is validated against the latest schema, which reports
    the missing required field."""
    declared = facts.get("partfactsVersion") if isinstance(facts, dict) else None
    if isinstance(declared, str) and declared not in _PARTFACTS_VALIDATORS:
        supported = ", ".join(SUPPORTED_PARTFACTS_VERSIONS)
        return {
            "valid": False,
            "errors": [
                f'/partfactsVersion: unsupported PartFacts version "{declared}" '
                f"(supported: {supported})"
            ],
        }
    validator = (
        _PARTFACTS_VALIDATORS.get(declared) or _PARTFACTS_VALIDATORS[PARTFACTS_SCHEMA_VERSION]
    )
    errors = [
        _format_error(error) for error in _iter_errors(validator, facts, _PARTFACTS_SCHEMA_FILE)
    ]
    return {"valid": not errors, "errors": errors}


def validate_printspec(spec, semantic=True):
    part = spec.get("part") if isinstance(spec, dict) else None
    part_type = part.get("type") if isinstance(part, dict) else None
    if isinstance(part_type, str):
        narrowed = _narrowed_printspec_validator(part_type)
        if narrowed is not None:
            errors = [
                _format_error(error)
                for error in _iter_errors(narrowed, spec, "printspec.schema.json")
            ]
            if not errors and semantic:
                errors.extend(validate_semantic(spec))
            return {"valid": not errors, "errors": errors}
    return _validate("printspec.schema.json", spec, semantic)
