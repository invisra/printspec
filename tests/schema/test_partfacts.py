import json
import socket
from pathlib import Path
from urllib import request

from jsonschema import Draft202012Validator
from printspec import validate_partfacts
from printspec.validate import (
    PARTFACTS_SCHEMA,
    PARTFACTS_SCHEMA_VERSION,
    SUPPORTED_PARTFACTS_VERSIONS,
)

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


def test_unsupported_version_gives_clear_dispatch_error():
    assert "0.1.0" in SUPPORTED_PARTFACTS_VERSIONS
    good = read(ROOT / "tests/fixtures/partfacts/valid/minimal-box.json")
    result = validate_partfacts({**good, "partfactsVersion": "0.2.0"})
    assert not result["valid"]
    assert len(result["errors"]) == 1
    assert "unsupported PartFacts version" in result["errors"][0]


def test_massproperties_optional_only_when_invalid():
    good = read(ROOT / "tests/fixtures/partfacts/valid/minimal-box.json")
    no_mass = {k: v for k, v in good.items() if k != "massProperties"}
    assert not validate_partfacts(no_mass)["valid"]

    invalid = json.loads(json.dumps(good))
    invalid["topology"]["valid"] = False
    invalid["topology"]["checks"] = [{"name": "free-edges", "status": "fail"}]
    invalid.pop("massProperties")
    assert validate_partfacts(invalid)["valid"]


def test_counterbore_and_split_hole_group_faces():
    cb = read(ROOT / "tests/fixtures/partfacts/valid/counterbore.json")
    assert validate_partfacts(cb)["valid"]
    face_ids = {f["featureId"] for f in cb["featureInventory"]["cylindricalFaces"]}
    assert len(face_ids) == 1
    segments = cb["featureInventory"]["holes"][0]["segments"]
    assert [s["radius"] for s in segments] == [2, 5]

    sh = read(ROOT / "tests/fixtures/partfacts/valid/split-hole.json")
    assert validate_partfacts(sh)["valid"]
    assert sh["featureInventory"]["holes"][0]["through"] is True


def test_multi_solid_document_validates():
    ms = read(ROOT / "tests/fixtures/partfacts/valid/multi-solid.json")
    assert validate_partfacts(ms)["valid"]
    assert ms["topology"]["solidCount"] == len(ms["solids"])


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
