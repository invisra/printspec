import json
import socket
from pathlib import Path
from urllib import request

from jsonschema import Draft202012Validator
from printspec import validate_partfacts
from printspec.validate import PARTFACTS_SCHEMA, PARTFACTS_SCHEMA_VERSION

ROOT = Path(__file__).resolve().parents[2]
PARTFACTS_ID = "https://schemas.invisra.ai/printspec/partfacts/0.1.0/partfacts.schema.json"
SOURCE = ROOT / "schemas" / "partfacts" / "0.1.0" / "partfacts.schema.json"


def read(path: Path):
    return json.loads(path.read_text(encoding="utf8"))


def test_partfacts_schema_version():
    assert PARTFACTS_SCHEMA_VERSION == "0.1.0"
    assert PARTFACTS_SCHEMA["$id"] == PARTFACTS_ID
    assert PARTFACTS_SCHEMA["properties"]["partfactsVersion"]["const"] == "0.1.0"


def test_partfacts_schema_is_valid_draft_2020_12():
    Draft202012Validator.check_schema(read(SOURCE))


def test_partfacts_schema_is_self_contained():
    """PartFacts must not $ref the document schemas so it validates offline
    with a standalone validator and stays decoupled from that version track."""
    refs = []

    def walk(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "$ref" and isinstance(item, str):
                    refs.append(item)
                else:
                    walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(read(SOURCE))
    assert refs, "schema should use internal $refs"
    assert all(ref.startswith("#") for ref in refs), refs


def test_valid_fixtures_validate():
    for path in sorted((ROOT / "tests/fixtures/partfacts/valid").glob("*.json")):
        result = validate_partfacts(read(path))
        assert result["valid"], f"{path.name}: {result['errors']}"


def test_invalid_fixtures_are_rejected():
    for path in sorted((ROOT / "tests/fixtures/partfacts/invalid").glob("*.json")):
        result = validate_partfacts(read(path))
        assert not result["valid"], path.name
        assert result["errors"], path.name


def test_wrong_version_is_rejected():
    good = read(ROOT / "tests/fixtures/partfacts/valid/minimal-box.json")
    good["partfactsVersion"] = "9.9.9"
    assert not validate_partfacts(good)["valid"]


def test_additional_top_level_property_is_rejected():
    good = read(ROOT / "tests/fixtures/partfacts/valid/minimal-box.json")
    good["surprise"] = True
    assert not validate_partfacts(good)["valid"]


def test_synced_partfacts_copies_match_source():
    source_text = SOURCE.read_text(encoding="utf8")
    for destination in [
        ROOT / "public" / "printspec" / "partfacts" / "0.1.0",
        ROOT / "packages" / "python" / "printspec" / "schemas" / "partfacts" / "0.1.0",
        ROOT / "packages" / "typescript" / "schemas" / "partfacts" / "0.1.0",
    ]:
        copy = destination / "partfacts.schema.json"
        assert copy.is_file(), (
            f"missing synced PartFacts schema at {copy.relative_to(ROOT)}; run `npm run sync:schemas`"
        )
        assert copy.read_text(encoding="utf8") == source_text, (
            f"{copy.relative_to(ROOT)} is stale; run `npm run sync:schemas`"
        )


def test_partfacts_listed_in_project_manifest():
    manifest = read(ROOT / "public" / "printspec" / "manifest.json")
    artifacts = {a["name"]: a for a in manifest.get("artifacts", [])}
    assert "partfacts" in artifacts, manifest.get("artifacts")
    assert "0.1.0" in artifacts["partfacts"]["versions"]
    version_manifest = read(ROOT / "public" / "printspec" / "partfacts" / "0.1.0" / "manifest.json")
    assert version_manifest["schemas"][0]["id"] == PARTFACTS_ID


def test_validation_is_offline(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("PartFacts validation attempted network access")

    monkeypatch.setattr(request, "urlopen", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    good = read(ROOT / "tests/fixtures/partfacts/valid/round-spacer-through-hole.json")
    assert validate_partfacts(good)["valid"]
