import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import _WrappedReferencingError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from .semantic import validate_semantic

_SCHEMA_BASE_URI = "https://schemas.invisra.com/printspec/0.1.0/"
def _schema_dir() -> Path:
    """Locate root schemas in source checkouts and editable installs.

    The canonical schemas live at the repository root. Walk upward so tests and
    editable installs do not depend on a fixed package nesting depth. Future
    wheels can add package-data loading here without changing validation code.
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


def _validate(schema_name: str, data, semantic: bool = False):
    if schema_name not in SCHEMAS:
        raise RuntimeError(f"Missing local schema: {schema_name}")
    validator = Draft202012Validator(
        SCHEMAS[schema_name], registry=_REGISTRY, format_checker=_FORMAT_CHECKER
    )
    try:
        errors = [
            _format_error(error)
            for error in sorted(validator.iter_errors(data), key=lambda e: list(e.path))
        ]
    except _WrappedReferencingError as exc:
        raise RuntimeError(f"Unable to resolve local JSON Schema reference for {schema_name}: {exc}") from exc
    if not errors and semantic:
        errors.extend(validate_semantic(data))
    return {"valid": not errors, "errors": errors}


def validate_part_family_spec(part):
    return _validate("part-family.schema.json", part)


def validate_composable_part_spec(part):
    return _validate("composable-part.schema.json", part)


def validate_project_spec(project):
    return _validate("project.schema.json", project)


def validate_printspec(spec, semantic=True):
    return _validate("printspec.schema.json", spec, semantic)
