import json
import socket
from pathlib import Path
from urllib import request

from jsonschema import Draft202012Validator
from printspec.validate import _REGISTRY, SCHEMAS, validate_printspec
from referencing import Resource

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_BASE_URI = "https://schemas.invisra.ai/printspec/0.2.0/"


def read(path: str):
    return json.loads((ROOT / path).read_text(encoding="utf8"))


def collect_refs(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref" and isinstance(item, str):
                yield item
            else:
                yield from collect_refs(item)
    elif isinstance(value, list):
        for item in value:
            yield from collect_refs(item)


def test_all_schemas_are_valid_draft_2020_12_schemas():
    for path in sorted((ROOT / "schemas").glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf8"))
        try:
            Draft202012Validator.check_schema(schema)
        except Exception as exc:
            raise AssertionError(f"{path.name} is not a valid Draft 2020-12 schema") from exc


def test_all_schemas_have_unique_expected_ids():
    ids = []
    for path in sorted((ROOT / "schemas").glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf8"))
        assert schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema", path.name
        assert schema.get("$id") == f"{SCHEMA_BASE_URI}{path.name}", path.name
        ids.append(schema["$id"])
    assert len(ids) == len(set(ids))


def assert_synced_schema_dir_matches_sources(destination: Path):
    source_paths = sorted((ROOT / "schemas").glob("*.schema.json"))
    destination_paths = sorted(destination.glob("*.schema.json"))
    source_names = [path.name for path in source_paths]
    destination_names = [path.name for path in destination_paths]

    assert destination_names == source_names, (
        f"{destination.relative_to(ROOT)} schema filenames differ from schemas/. "
        f"Run `npm run sync:schemas`. "
        f"missing={sorted(set(source_names) - set(destination_names))} "
        f"extra={sorted(set(destination_names) - set(source_names))}"
    )
    for source_path in source_paths:
        destination_path = destination / source_path.name
        assert destination_path.read_text(encoding="utf8") == source_path.read_text(
            encoding="utf8"
        ), (
            f"{destination_path.relative_to(ROOT)} is stale or divergent from "
            f"schemas/{source_path.name}; run `npm run sync:schemas`"
        )


def test_synced_schema_artifacts_match_sources():
    destinations = [
        ROOT / "public" / "printspec" / "0.2.0",
        ROOT / "packages" / "python" / "printspec" / "schemas",
        ROOT / "packages" / "typescript" / "schemas",
    ]
    for destination in destinations:
        assert_synced_schema_dir_matches_sources(destination)


def test_local_refs_resolve_without_network():
    for filename, schema in SCHEMAS.items():
        for ref in collect_refs(schema):
            if ref.startswith("#"):
                continue
            base = ref.split("#", 1)[0]
            assert base in SCHEMAS, f"{filename} has unresolved local ref {ref}"


def test_schema_registry_contains_all_local_aliases():
    for filename, schema in SCHEMAS.items():
        for uri in {filename, schema["$id"], f"{SCHEMA_BASE_URI}{filename}"}:
            resource = _REGISTRY.get_or_retrieve(uri).value
            assert isinstance(resource, Resource), f"missing schema registry alias {uri}"


def test_examples_and_fixtures_validate_by_expected_validity():
    for path in sorted((ROOT / "examples").rglob("*.json")):
        result = validate_printspec(json.loads(path.read_text(encoding="utf8")))
        assert result["valid"], f"{path.relative_to(ROOT)}: {result['errors']}"
    for path in sorted((ROOT / "tests/fixtures/valid").glob("*.json")):
        result = validate_printspec(json.loads(path.read_text(encoding="utf8")))
        assert result["valid"], f"{path.name}: {result['errors']}"
    for path in sorted((ROOT / "tests/fixtures/invalid").glob("*.json")):
        assert not validate_printspec(json.loads(path.read_text(encoding="utf8")))["valid"], (
            path.name
        )


def test_nested_schema_refs_validate_offline(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("validation attempted network access")

    monkeypatch.setattr(request, "urlopen", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)

    rounded_plate_chain = read("examples/part-families/rounded-rectangular-plate.basic.json")
    rounded_plate_chain["part"]["parameters"]["holes"] = [
        {"x": 5, "y": 5, "diameter": 3.2, "depth": "through"}
    ]
    assert validate_printspec(rounded_plate_chain)["valid"]

    project_chain = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "project": {
            "type": "project",
            "label": "Offline nested project",
            "parts": [{"id": "plate", "label": "Plate", "spec": rounded_plate_chain}],
        },
    }
    assert validate_printspec(project_chain)["valid"]
