import json
import os
import subprocess
import sys
from pathlib import Path

from printspec import (
    bom_to_csv,
    bom_to_markdown,
    bom_to_supplier_order_list,
    create_bundle,
    extract_bom,
    generate_cadquery,
    generate_openscad,
    list_part_families,
    validate_composable_part_spec,
    validate_part_family_spec,
    validate_printspec,
)

root = Path(__file__).resolve().parents[2]


def read(p):
    return json.loads((root / p).read_text())


def norm(s):
    return "\n".join(line.rstrip() for line in s.replace("\r\n", "\n").split("\n")).rstrip() + "\n"


spec = read(Path("examples/part-families/rounded-rectangular-plate.basic.json"))
project = read(Path("examples/projects/simple-enclosure-project.json"))


def test_shared_valid_fixtures_pass():
    for f in (root / "tests/fixtures/valid").glob("*.json"):
        r = validate_printspec(json.loads(f.read_text()))
        assert r["valid"], f"{f.name}: {r['errors']}"


def test_shared_invalid_fixtures_fail():
    for f in (root / "tests/fixtures/invalid").glob("*.json"):
        assert not validate_printspec(json.loads(f.read_text()))["valid"], f.name


def test_validation_and_models():
    assert validate_printspec(spec)["valid"]
    from printspec.models import PrintSpec

    assert PrintSpec(**spec).units == "mm"


def test_package_local_schema_resources_exist():
    from importlib.resources import files

    schema_dir = files("printspec").joinpath("schemas")
    assert schema_dir.is_dir()
    assert schema_dir.joinpath("printspec.schema.json").is_file()
    assert schema_dir.joinpath("common.schema.json").is_file()
    assert validate_printspec(spec)["valid"]


def test_bom_helpers():
    bom = extract_bom(project)
    assert bom[0]["quantity"] == 4
    assert "lid_screws" in bom_to_markdown(bom)
    assert "91292A112" in bom_to_csv(bom)
    assert "mcmaster" in bom_to_supplier_order_list(bom)


def test_top_level_hardware_quantity_accepts_a_whole_valued_float():
    # A real parity gap, found and fixed: this semantic check previously
    # used isinstance(quantity, int), which rejects a JSON 5.0 that parses
    # to a Python float, even though JSON Schema's "integer" type (and JS's
    # Number.isInteger(), which has no separate int/float) both accept it.
    # Mirrors the TypeScript-side test in tests/typescript/printspec.test.js.
    def with_hardware(quantity):
        s = json.loads(json.dumps(spec))
        s["hardware"] = [{"id": "screw_1", "kind": "screw", "quantity": quantity}]
        return s

    assert validate_printspec(with_hardware(5.0)) == {"valid": True, "errors": []}
    assert validate_printspec(with_hardware(0.5))["valid"] is False


def test_generators():
    assert generate_openscad(spec)["code"] == generate_openscad(spec)["code"]
    cq = generate_cadquery(spec)["code"]
    assert "part =" in cq and "export" not in cq and "subprocess" not in cq
    bad = json.loads(json.dumps(spec))
    bad["part"]["parameters"]["cornerRadius"] = 999
    assert (
        not generate_openscad(bad)["supported"]
        and "Validation failed" in generate_openscad(bad)["message"]
    )


def test_generator_snapshots_match_fixtures():
    items = [
        (
            "rounded-rectangular-plate.basic",
            "examples/part-families/rounded-rectangular-plate.basic.json",
        ),
        ("spacer-block.four-hole", "examples/part-families/spacer-block.four-hole.json"),
        ("round-spacer.basic", "examples/part-families/round-spacer.basic.json"),
        ("electronics-standoff.m3", "examples/part-families/electronics-standoff.m3.json"),
    ]
    for name, file in items:
        s = read(Path(file))
        assert norm(generate_openscad(s)["code"]) == norm(
            (root / f"tests/fixtures/generated/openscad/{name}.scad").read_text()
        )
        assert norm(generate_cadquery(s)["code"]) == norm(
            (root / f"tests/fixtures/generated/cadquery/{name}.py").read_text()
        )


def test_all_ten_core_families():
    from printspec import create_bundle

    files = [
        "round-spacer.basic.json",
        "spacer-block.four-hole.json",
        "electronics-standoff.m3.json",
        "rounded-rectangular-plate.basic.json",
        "cable-comb.usb.json",
        "cable-clip.basic.json",
        "wall-mount-bracket.basic.json",
        "l-bracket.basic.json",
        "drawer-divider.basic.json",
        "project-enclosure-tray.basic.json",
    ]
    seen = set()
    for file in files:
        s = read(Path("examples/part-families/" + file))
        part_type = s["part"]["type"]
        seen.add(part_type)
        assert validate_printspec(s) == {"valid": True, "errors": []}, part_type
        scad = generate_openscad(s)
        assert scad["supported"], (part_type, scad.get("message"))
        cq = generate_cadquery(s)
        assert cq["supported"], (part_type, cq.get("message"))
        assert "part =" in cq["code"], part_type
        bundle = create_bundle(s)
        assert bundle["supported"], part_type
        paths = {f["path"] for f in bundle["files"]}
        for required in (
            "printspec.json",
            "cad/model.scad",
            "cad/model.py",
            "README.md",
            "bundle-manifest.json",
        ):
            assert required in paths, (part_type, required)
    assert len(seen) == 10


def test_generator_supported_metadata_matches_actual_support():
    by_type = {}
    for f in (root / "examples/part-families").glob("*.json"):
        s = json.loads(f.read_text())
        if s.get("part"):
            by_type[s["part"]["type"]] = s
    families = list_part_families()
    assert families
    for family in families:
        example = by_type.get(family["type"])
        assert example, f"no example fixture for family {family['type']}"
        scad_supported = generate_openscad(example)["supported"]
        cq_supported = generate_cadquery(example)["supported"]
        assert scad_supported == cq_supported, (
            f"{family['type']}: openscad/cadquery support disagree"
        )
        assert family["generatorSupported"] == scad_supported, (
            f"{family['type']}: generatorSupported metadata ({family['generatorSupported']}) does not match actual generator support ({scad_supported})"
        )


def test_warning_behavior():
    s = read(Path("examples/part-families/round-spacer.basic.json"))
    s["part"]["parameters"]["fillet"] = {"radius": 0.25}
    assert generate_cadquery(s)["warnings"] == ["fillet requested but not implemented"]


def test_l_bracket_cuts_holes_and_slots_on_both_legs():
    s = read(Path("examples/part-families/l-bracket.holes-and-slots.json"))
    assert validate_printspec(s) == {"valid": True, "errors": []}
    for generate in (generate_openscad, generate_cadquery):
        r = generate(s)
        assert r["supported"] is True
        assert "holeDiameter" not in r["code"] and "holesPerLeg" not in r["code"]
        assert "3.2" in r["code"]
    assert "rotate([0, 90, 0])" in generate_openscad(s)["code"]
    assert "rotate((0, 0, 0), (0, 1, 0), 90)" in generate_cadquery(s)["code"]
    with_y_axis = json.loads(json.dumps(s))
    with_y_axis["part"]["parameters"]["holes"].append(
        {"x": 5, "y": 0, "diameter": 3, "depth": "through", "axis": "y"}
    )
    assert any(
        "axis 'y' is not implemented for l_bracket" in w
        for w in generate_openscad(with_y_axis)["warnings"]
    )


def test_cable_clip_cuts_mounting_holes_from_schema_array():
    s = read(Path("examples/part-families/cable-clip.with-mount-hole.json"))
    assert validate_printspec(s) == {"valid": True, "errors": []}
    for generate in (generate_openscad, generate_cadquery):
        r = generate(s)
        assert r["supported"] is True
        assert "mountHoleDiameter" not in r["code"]
        assert "3.2" in r["code"]


def test_composable_part_clearance_fit_boss_and_cap_example_validates():
    spec = read(Path("examples/composable/clearance-fit-boss-and-cap.json"))
    assert validate_printspec(spec) == {"valid": True, "errors": []}


def test_composable_part_dimension_constraints_validate_already_authored_numbers():
    # Mirrors the TypeScript-side test in tests/typescript/printspec.test.js;
    # both semantic validators must stay in parity even though only
    # TypeScript has a brepjs generator (constraints don't feed into
    # generation at all -- they're purely a validation-time assertion).
    base = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "part": {
            "type": "composable_part",
            "label": "constraints test",
            "components": [
                {
                    "id": "plate",
                    "kind": "plate",
                    "operation": "add",
                    "dimensions": {"length": 40, "width": 40, "thickness": 4},
                },
                {
                    "id": "boss",
                    "kind": "cylinder",
                    "operation": "add",
                    "dimensions": {"diameter": 6, "height": 5},
                },
            ],
            "features": [
                {
                    "id": "hole",
                    "kind": "hole",
                    "target": "plate",
                    "parameters": {"diameter": 8, "depth": "through"},
                }
            ],
        },
    }

    def with_constraint(c):
        part = dict(base["part"])
        part["constraints"] = [c]
        return {**base, "part": part}

    # Passes: hole diameter (8) >= boss diameter (6) + 0.4 margin.
    assert validate_printspec(
        with_constraint(
            {
                "type": "dimension",
                "id": "clearance",
                "left": {"ref": "hole", "key": "diameter"},
                "operator": ">=",
                "right": {"ref": "boss", "key": "diameter"},
                "margin": 0.4,
            }
        )
    ) == {"valid": True, "errors": []}

    # Fails: margin too large for the actual numbers (8 >= 6 + 5 is false).
    assert "constraint clearance failed: 8 >= 6 + 5 is false" in " ".join(
        validate_printspec(
            with_constraint(
                {
                    "type": "dimension",
                    "id": "clearance",
                    "left": {"ref": "hole", "key": "diameter"},
                    "operator": ">=",
                    "right": {"ref": "boss", "key": "diameter"},
                    "margin": 5,
                }
            )
        )["errors"]
    )

    # Unknown ref and unknown/non-numeric key are both reported distinctly.
    assert (
        "constraint clearance left references unknown component/feature: nonexistent"
        in " ".join(
            validate_printspec(
                with_constraint(
                    {
                        "type": "dimension",
                        "id": "clearance",
                        "left": {"ref": "nonexistent", "key": "diameter"},
                        "operator": ">=",
                        "right": 1,
                    }
                )
            )["errors"]
        )
    )
    assert (
        'constraint clearance left references non-numeric or missing dimension "notarealkey" on boss'
        in " ".join(
            validate_printspec(
                with_constraint(
                    {
                        "type": "dimension",
                        "id": "clearance",
                        "left": {"ref": "boss", "key": "notarealkey"},
                        "operator": ">=",
                        "right": 1,
                    }
                )
            )["errors"]
        )
    )

    # Literal-vs-literal (no refs at all) works too.
    assert validate_printspec(
        with_constraint({"type": "dimension", "left": 5, "operator": "<", "right": 10})
    ) == {"valid": True, "errors": []}

    # No `id`: the constraint's array index is used in the message instead.
    assert "constraint #0 failed: 10 < 5 is false" in " ".join(
        validate_printspec(
            with_constraint({"type": "dimension", "left": 10, "operator": "<", "right": 5})
        )["errors"]
    )

    # A feature's `parameters` (not just a component's `dimensions`) can be
    # referenced too.
    assert validate_printspec(
        with_constraint(
            {
                "type": "dimension",
                "left": {"ref": "hole", "key": "diameter"},
                "operator": "==",
                "right": 8,
            }
        )
    ) == {"valid": True, "errors": []}


def test_composable_part_groups_validate_ids_member_ids_and_relation_targets():
    strip = read(Path("examples/composable/cable-tie-anchor-strip.json"))
    assert validate_printspec(strip) == {"valid": True, "errors": []}
    mount = read(Path("examples/composable/vented-sensor-mount-with-standoffs.json"))
    assert validate_printspec(mount) == {"valid": True, "errors": []}

    unknown_member = json.loads(json.dumps(strip))
    unknown_member["part"]["groups"][0]["memberIds"].append("nonexistent")
    assert (
        "group post_left_assembly memberIds references unknown component: nonexistent"
        in " ".join(validate_printspec(unknown_member)["errors"])
    )

    dup_group_id = json.loads(json.dumps(strip))
    dup_group_id["part"]["groups"][1]["id"] = dup_group_id["part"]["groups"][0]["id"]
    assert "duplicate group id" in " ".join(validate_printspec(dup_group_id)["errors"])

    unknown_group_target = json.loads(json.dumps(strip))
    unknown_group_target["part"]["groups"][1]["relation"]["target"] = "ghost"
    assert "group post_right_assembly relation target does not exist: ghost" in " ".join(
        validate_printspec(unknown_group_target)["errors"]
    )

    # A component's relation may target a group id (not just another component).
    targets_group = json.loads(json.dumps(mount))
    targets_group["part"]["components"].append(
        {
            "id": "reference_marker",
            "kind": "box",
            "operation": "add",
            "dimensions": {"length": 1, "width": 1, "height": 1},
            "relation": {"type": "centered_on", "target": "standoffs"},
        }
    )
    assert validate_printspec(targets_group) == {"valid": True, "errors": []}

    # relation.offset was removed in favor of position as the sole offset.
    with_offset = json.loads(json.dumps(strip))
    with_offset["part"]["groups"][1]["relation"]["offset"] = {"x": 1, "y": 0, "z": 0}
    assert validate_printspec(with_offset)["valid"] is False

    # Component/feature/group ids are checked as one combined namespace, since
    # target resolution treats them as one, even though each category is also
    # checked for internal duplicates separately.
    cross_category_dupe = json.loads(json.dumps(strip))
    cross_category_dupe["part"]["groups"][0]["id"] = "post_left"
    assert "id used by more than one component/feature/group: post_left" in " ".join(
        validate_printspec(cross_category_dupe)["errors"]
    )


def test_composable_part_rejects_a_cycle_formed_only_by_feature_target_chains():
    # Regression test: a feature's bare `target` (used as an implicit
    # position anchor even without an explicit `relation`) previously wasn't
    # part of the cycle-detection graph, so two features that `target` each
    # other passed validation cleanly (this would crash the TypeScript
    # generator with a stack overflow; Python has no composable_part
    # generator, but the same dependency graph is shared).
    spec = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "part": {
            "type": "composable_part",
            "label": "feature target cycle test",
            "components": [
                {
                    "id": "a",
                    "kind": "box",
                    "operation": "add",
                    "dimensions": {"length": 10, "width": 10, "height": 10},
                }
            ],
            "features": [
                {"id": "f1", "kind": "hole", "target": "f2", "parameters": {"diameter": 2}},
                {"id": "f2", "kind": "hole", "target": "f1", "parameters": {"diameter": 2}},
            ],
        },
    }
    assert "relation cycle detected: f1 -> f2 -> f1" in " ".join(validate_printspec(spec)["errors"])


def test_composable_part_open_top_enclosure_shell_example_validates():
    spec = read(Path("examples/composable/open-top-enclosure-shell.json"))
    assert validate_printspec(spec) == {"valid": True, "errors": []}


def test_composable_part_rejects_a_shell_feature_whose_thickness_is_too_large():
    # Mirrors the TypeScript-side test in tests/typescript/printspec.test.js;
    # both semantic validators must stay in parity even though only
    # TypeScript has a brepjs generator to actually build the shell.
    spec = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "part": {
            "type": "composable_part",
            "label": "shell thickness bounds test",
            "components": [
                {
                    "id": "a",
                    "kind": "box",
                    "operation": "add",
                    "dimensions": {"length": 10, "width": 10, "height": 6},
                }
            ],
            "features": [
                {
                    "id": "hollow",
                    "kind": "shell",
                    "target": "a",
                    "parameters": {"thickness": 4, "openFaces": ["top"]},
                }
            ],
        },
    }
    assert (
        "feature hollow thickness must be less than half of target a's smallest dimension (4 >= 3)"
        in " ".join(validate_printspec(spec)["errors"])
    )


def test_composable_part_bounded_dimension_error_formats_whole_valued_floats_like_js():
    # A real parity gap, found and fixed: _bounded_dimension_error() only
    # reformatted its `bound` operand to drop a trailing ".0" (matching how
    # JS's `${n}` prints a whole-valued number), not the `value` operand on
    # the same line -- so a feature parameter authored as 4.0 in JSON
    # printed as "4.0" here but "4" in the TypeScript-side message. Mirrors
    # the same 4.0-authored spec against the TypeScript-side test.
    spec = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "part": {
            "type": "composable_part",
            "label": "shell thickness float formatting test",
            "components": [
                {
                    "id": "a",
                    "kind": "box",
                    "operation": "add",
                    "dimensions": {"length": 10, "width": 10, "height": 6},
                }
            ],
            "features": [
                {
                    "id": "hollow",
                    "kind": "shell",
                    "target": "a",
                    "parameters": {"thickness": 4.0, "openFaces": ["top"]},
                }
            ],
        },
    }
    assert (
        "feature hollow thickness must be less than half of target a's smallest dimension (4 >= 3)"
        in " ".join(validate_printspec(spec)["errors"])
    )


def test_composable_part_rounded_top_chamfered_lid_example_validates():
    spec = read(Path("examples/composable/rounded-top-chamfered-lid.json"))
    assert validate_printspec(spec) == {"valid": True, "errors": []}


def test_composable_part_rejects_a_fillet_or_chamfer_feature_whose_size_is_too_large():
    # Mirrors the TypeScript-side test in tests/typescript/printspec.test.js;
    # both semantic validators must stay in parity even though only
    # TypeScript has a brepjs generator to actually build the fillet/chamfer.
    def spec(kind, param, value):
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "fillet/chamfer bounds test",
                "components": [
                    {
                        "id": "a",
                        "kind": "box",
                        "operation": "add",
                        "dimensions": {"length": 10, "width": 10, "height": 6},
                    }
                ],
                "features": [
                    {
                        "id": "f",
                        "kind": kind,
                        "target": "a",
                        "parameters": {param: value, "edges": "top"},
                    }
                ],
            },
        }

    assert (
        "feature f radius must be less than half of target a's smallest dimension (4 >= 3)"
        in " ".join(validate_printspec(spec("fillet", "radius", 4))["errors"])
    )
    assert (
        "feature f distance must be less than half of target a's smallest dimension (4 >= 3)"
        in " ".join(validate_printspec(spec("chamfer", "distance", 4))["errors"])
    )


def test_composable_part_fillet_chamfer_all_edges_schema_validates():
    # "all" (every edge on the target, via brepjs's real edgeFinder().findAll(),
    # a full 3D round-over) is brepjs-generator-only support (restricted to
    # box/plate/tab there), so Python's job is schema validation, checked
    # here for parity with the TypeScript generator test in
    # tests/typescript/printspec.test.js.
    def spec(kind, param, edges):
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "all edges schema test",
                "components": [
                    {
                        "id": "a",
                        "kind": "box",
                        "operation": "add",
                        "dimensions": {"length": 20, "width": 20, "height": 10},
                    }
                ],
                "features": [
                    {"id": "f", "kind": kind, "target": "a", "parameters": {param: 2, "edges": edges}}
                ],
            },
        }

    assert validate_printspec(spec("fillet", "radius", "all")) == {"valid": True, "errors": []}
    assert validate_printspec(spec("chamfer", "distance", "all")) == {"valid": True, "errors": []}
    assert validate_printspec(spec("fillet", "radius", "diagonal"))["valid"] is False


def test_composable_part_id_tag_with_embossed_and_engraved_text_example_validates():
    spec = read(Path("examples/composable/id-tag-with-embossed-and-engraved-text.json"))
    assert validate_printspec(spec) == {"valid": True, "errors": []}


def test_composable_part_text_feature_font_url_and_engrave_depth_validation():
    # Mirrors the TypeScript-side tests in tests/typescript/printspec.test.js;
    # both semantic validators must stay in parity even though only
    # TypeScript has a brepjs generator to actually build the text.
    def spec(font_url=None, depth=0.6, mode="emboss"):
        params = {"content": "Hi", "depth": depth, "mode": mode}
        if font_url is not None:
            params["fontUrl"] = font_url
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "text validation test",
                "components": [
                    {
                        "id": "a",
                        "kind": "box",
                        "operation": "add",
                        "dimensions": {"length": 20, "width": 20, "height": 6},
                    }
                ],
                "features": [{"id": "t", "kind": "text", "target": "a", "parameters": params}],
            },
        }

    # Deliberately doesn't rely on the schema's "format": "uri" for
    # well-formed-URL-ness -- that keyword is a silent no-op in this
    # validator (no "uri" FormatChecker registered without the optional
    # rfc3987 package, which this project doesn't depend on), so semantic
    # validation must catch a malformed URL itself, the same pre-existing
    # gap supplierReference.url already works around elsewhere.
    assert "feature t (text) fontUrl is not a valid URL: not-a-url" in " ".join(
        validate_printspec(spec(font_url="not-a-url"))["errors"]
    )
    # file:// is syntactically valid but real-kernel-verified to never work
    # (Node's fetch() throws on it outright).
    assert (
        'feature t (text) fontUrl must be an http(s):// URL or a data: URI (got "file:")'
        in " ".join(
            validate_printspec(spec(font_url="file:///home/user/fonts/Custom.ttf"))["errors"]
        )
    )
    # an allowed-but-irrelevant scheme (e.g. ftp:) is rejected the same way.
    assert (
        'feature t (text) fontUrl must be an http(s):// URL or a data: URI (got "ftp:")'
        in " ".join(validate_printspec(spec(font_url="ftp://example.com/font.ttf"))["errors"])
    )
    # an empty-host http(s):// URL (e.g. "http://") is rejected too, for
    # parity with JS's new URL() throwing outright on it -- Python's
    # urlparse() alone doesn't catch this (it happily returns scheme="http"
    # with an empty netloc).
    assert "feature t (text) fontUrl is not a valid URL: http://" in " ".join(
        validate_printspec(spec(font_url="http://"))["errors"]
    )
    # http(s):// and data: URIs are both fine.
    assert validate_printspec(spec(font_url="https://example.com/font.ttf")) == {
        "valid": True,
        "errors": [],
    }
    assert validate_printspec(spec(font_url="data:font/ttf;base64,AAAA")) == {
        "valid": True,
        "errors": [],
    }
    # engrave depth exceeding the target's own depth dimension is rejected.
    assert "feature t engrave depth must be less than target a height (8 >= 6)" in " ".join(
        validate_printspec(spec(font_url="https://example.com/font.ttf", depth=8, mode="engrave"))[
            "errors"
        ]
    )
    # emboss has no depth ceiling -- the same depth is fine in emboss mode.
    assert validate_printspec(
        spec(font_url="https://example.com/font.ttf", depth=8, mode="emboss")
    ) == {"valid": True, "errors": []}


def test_composable_part_relations_reject_ambiguous_targets_and_group_transform_conflicts():
    def box(id_, **extra):
        c = {
            "id": id_,
            "kind": "box",
            "operation": "add",
            "dimensions": {"length": 10, "width": 10, "height": 10},
        }
        c.update(extra)
        return c

    def spec(components, groups=None):
        part = {"type": "composable_part", "label": "ambiguity test", "components": components}
        if groups:
            part["groups"] = groups
        return {"printspecVersion": "0.2.0", "units": "mm", "part": part}

    rect_pattern = {"type": "rectangular", "countX": 2, "countY": 2, "spacingX": 20, "spacingY": 20}

    # A relation may not anchor to a patterned component (no single instance
    # to anchor to), but CSG (appliesTo) against a patterned target is fine.
    targets_pattern = spec(
        [
            box("a", pattern=rect_pattern),
            box("b", relation={"type": "on_top_of", "target": "a"}),
        ]
    )
    assert (
        "relation target is a patterned component/feature and cannot be used as a positional "
        "anchor: a" in " ".join(validate_printspec(targets_pattern)["errors"])
    )
    cuts_pattern = spec(
        [
            box("a", pattern=rect_pattern),
            box(
                "cut",
                operation="subtract",
                appliesTo=["a"],
                dimensions={"length": 2, "width": 2, "height": 2},
            ),
        ]
    )
    assert validate_printspec(cuts_pattern) == {"valid": True, "errors": []}

    # A group's relation may not target its own member.
    group_targets_own_member = spec(
        [box("a"), box("b")],
        groups=[
            {"id": "grp", "memberIds": ["a"], "relation": {"type": "on_top_of", "target": "a"}}
        ],
    )
    assert "group grp relation target is one of its own members: a" in " ".join(
        validate_printspec(group_targets_own_member)["errors"]
    )
    group_targets_other = spec(
        [box("a"), box("b")],
        groups=[
            {"id": "grp", "memberIds": ["a"], "relation": {"type": "on_top_of", "target": "b"}}
        ],
    )
    assert validate_printspec(group_targets_other) == {"valid": True, "errors": []}

    # A component may not belong to more than one group that itself has a
    # position/rotation/relation, since it would be ambiguous which (or how
    # many) transforms apply; purely organizational (transform-free) groups
    # don't count.
    two_transforming_groups = spec(
        [box("a"), box("b")],
        groups=[
            {"id": "g1", "memberIds": ["a"], "position": {"x": 1, "y": 0, "z": 0}},
            {"id": "g2", "memberIds": ["a"], "position": {"x": 2, "y": 0, "z": 0}},
        ],
    )
    assert (
        "component a is a member of more than one group with its own "
        "position/rotation/relation/pattern: g1, g2"
        in " ".join(validate_printspec(two_transforming_groups)["errors"])
    )
    one_transforming_one_tag = spec(
        [box("a"), box("b")],
        groups=[
            {"id": "g1", "memberIds": ["a"], "position": {"x": 1, "y": 0, "z": 0}},
            {"id": "g2", "memberIds": ["a"]},
        ],
    )
    assert validate_printspec(one_transforming_one_tag) == {"valid": True, "errors": []}

    # A grouped component's world position depends on its transforming
    # group's own resolved transform, which is itself a dependency edge --
    # so a cycle that only closes through that implicit edge (not through
    # any single node's own `relation`) must still be caught, not
    # infinite-loop.
    cycle_via_group_membership = spec(
        [box("a"), box("b", relation={"type": "on_top_of", "target": "a"})],
        groups=[
            {
                "id": "g",
                "memberIds": ["a"],
                "position": {"x": 1, "y": 0, "z": 0},
                "relation": {"type": "on_top_of", "target": "b"},
            }
        ],
    )
    assert "relation cycle detected: b -> a -> g -> b" in " ".join(
        validate_printspec(cycle_via_group_membership)["errors"]
    )


def test_composable_part_group_pattern_semantic_checks():
    def box(id_, **extra):
        c = {
            "id": id_,
            "kind": "box",
            "operation": "add",
            "dimensions": {"length": 10, "width": 10, "height": 10},
        }
        c.update(extra)
        return c

    def spec(components, groups):
        part = {
            "type": "composable_part",
            "label": "group pattern semantic test",
            "components": components,
            "groups": groups,
        }
        return {"printspecVersion": "0.2.0", "units": "mm", "part": part}

    rect_pattern = {"type": "rectangular", "countX": 2, "countY": 2, "spacingX": 20, "spacingY": 20}

    # A patterned group (no single instance to anchor to) may not be a
    # relation target -- the same restriction as a patterned component or
    # feature.
    targets_patterned_group = spec(
        [box("a"), box("b", relation={"type": "on_top_of", "target": "grp"})],
        groups=[{"id": "grp", "memberIds": ["a"], "pattern": rect_pattern}],
    )
    assert (
        "relation target is a patterned component/feature and cannot be used as a positional "
        "anchor: grp" in " ".join(validate_printspec(targets_patterned_group)["errors"])
    )

    # A `pattern`-only group (no position/rotation/relation) still counts as
    # "transforming" for the at-most-one-transforming-group-per-member rule.
    pattern_and_position_conflict = spec(
        [box("a")],
        groups=[
            {"id": "g1", "memberIds": ["a"], "pattern": rect_pattern},
            {"id": "g2", "memberIds": ["a"], "position": {"x": 1, "y": 0, "z": 0}},
        ],
    )
    assert (
        "component a is a member of more than one group with its own "
        "position/rotation/relation/pattern: g1, g2"
        in " ".join(validate_printspec(pattern_and_position_conflict)["errors"])
    )

    # A single patterned group with no other transforming group is fine.
    valid_group_pattern = spec(
        [box("a")], groups=[{"id": "g1", "memberIds": ["a"], "pattern": rect_pattern}]
    )
    assert validate_printspec(valid_group_pattern) == {"valid": True, "errors": []}


def test_composable_part_group_rejects_inherit_rotation():
    # inheritRotation is only meaningful on a component or feature relation
    # (something with its own rotate-then-translate placement); a group's
    # relation only positions the group as a whole, so inheritRotation there
    # has no well-defined target to apply to.
    spec = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "part": {
            "type": "composable_part",
            "label": "group inheritRotation rejection test",
            "components": [
                {
                    "id": "a",
                    "kind": "box",
                    "operation": "add",
                    "dimensions": {"length": 10, "width": 10, "height": 10},
                },
                {
                    "id": "b",
                    "kind": "box",
                    "operation": "add",
                    "dimensions": {"length": 10, "width": 10, "height": 10},
                },
            ],
            "groups": [
                {
                    "id": "g",
                    "memberIds": ["b"],
                    "relation": {"type": "on_top_of", "target": "a", "inheritRotation": True},
                }
            ],
        },
    }
    assert (
        "group g relation may not set inheritRotation: only valid on a component or feature "
        "relation" in " ".join(validate_printspec(spec)["errors"])
    )


def test_composable_part_rejects_an_inverted_tube():
    # Regression test: an inverted tube (innerDiameter >= outerDiameter)
    # previously validated cleanly but real-kernel testing confirmed it
    # produces a zero-volume, degenerate solid ("shape has no geometry")
    # with no warning at all -- the documented "innerDiameter must be less
    # than outerDiameter" constraint was never actually checked.
    def spec(inner):
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "inverted tube test",
                "components": [
                    {
                        "id": "badTube",
                        "kind": "tube",
                        "operation": "add",
                        "dimensions": {"outerDiameter": 10, "innerDiameter": inner, "height": 10},
                    }
                ],
            },
        }

    assert (
        "component badTube (tube) innerDiameter must be less than outerDiameter (20 >= 10)"
        in " ".join(validate_printspec(spec(20))["errors"])
    )
    assert "innerDiameter must be less than outerDiameter" in " ".join(
        validate_printspec(spec(10))["errors"]
    )
    assert validate_printspec(spec(6)) == {"valid": True, "errors": []}


def test_composable_part_sphere_torus_ellipsoid_schemas_validate():
    # sphere/torus/ellipsoid are brepjs-only (no Python generator support
    # for composable_part), so Python's job is just schema/semantic
    # validation, checked here for parity with the TypeScript generator
    # tests in tests/typescript/printspec.test.js.
    sphere_spec = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "part": {
            "type": "composable_part",
            "label": "sphere test",
            "components": [
                {"id": "ball", "kind": "sphere", "operation": "add", "dimensions": {"diameter": 20}}
            ],
        },
    }
    assert validate_printspec(sphere_spec) == {"valid": True, "errors": []}

    def torus_spec(outer, tube):
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "torus test",
                "components": [
                    {
                        "id": "ring",
                        "kind": "torus",
                        "operation": "add",
                        "dimensions": {"outerDiameter": outer, "tubeDiameter": tube},
                    }
                ],
            },
        }

    assert validate_printspec(torus_spec(20, 6)) == {"valid": True, "errors": []}
    assert (
        "component ring (torus) tubeDiameter must be less than outerDiameter (20 >= 10)"
        in " ".join(validate_printspec(torus_spec(10, 20))["errors"])
    )

    ellipsoid_spec = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "part": {
            "type": "composable_part",
            "label": "ellipsoid test",
            "components": [
                {
                    "id": "dome",
                    "kind": "ellipsoid",
                    "operation": "add",
                    "dimensions": {"lengthX": 30, "lengthY": 20, "lengthZ": 10},
                }
            ],
        },
    }
    assert validate_printspec(ellipsoid_spec) == {"valid": True, "errors": []}


def test_composable_part_clearance_constraint_structural_checks():
    # A `clearance` constraint needs each component's fully resolved world
    # position, which only the TypeScript brepjs generator can compute --
    # Python's job (no composable_part generator at all) is just the
    # structural check: that a/b reference real, distinct, geometrically
    # well-defined components. Whether the constraint's minDistance
    # actually holds is never evaluated here, regardless of how close the
    # two components' authored positions actually are.
    def spec(constraint_b, extra_components=None):
        components = [
            {"id": "a", "kind": "box", "operation": "add", "dimensions": {"length": 10, "width": 10, "height": 10}},
            {
                "id": "b",
                "kind": "box",
                "operation": "add",
                "dimensions": {"length": 10, "width": 10, "height": 10},
                "position": {"x": 10.5, "y": 0, "z": 0},
            },
        ] + (extra_components or [])
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "clearance structural test",
                "components": components,
                "constraints": [{"type": "clearance", "id": "gap", "a": "a", "b": constraint_b, "minDistance": 2}],
            },
        }

    # Structurally valid even though a/b are only 0.5mm apart, less than
    # minDistance -- semantic validation never resolves position.
    assert validate_printspec(spec("b")) == {"valid": True, "errors": []}

    assert (
        "constraint gap b references unknown component: nope"
        in " ".join(validate_printspec(spec("nope"))["errors"])
    )

    self_ref = spec("a")
    assert "constraint gap a and b must be different components" in " ".join(
        validate_printspec(self_ref)["errors"]
    )

    rib = {"id": "r", "kind": "rib", "operation": "add", "dimensions": {"length": 10, "height": 5, "thickness": 2}}
    assert (
        'constraint gap b references component r (kind "rib"), which has no well-defined bounding box'
        in " ".join(validate_printspec(spec("r", [rib]))["errors"])
    )


def test_composable_part_relation_target_instance_validation():
    # relation.targetInstance needs each component's fully resolved world
    # position to actually anchor to, which only the TypeScript brepjs
    # generator can compute -- Python's job is just the structural check
    # (in range, target actually patterned, not a group), for parity with
    # the TypeScript generator tests in tests/typescript/printspec.test.js.
    def spec(rel_overrides, extra_groups=None):
        rel = {"type": "offset_from", "target": "hole"}
        rel.update(rel_overrides)
        part = {
            "type": "composable_part",
            "label": "targetInstance validation test",
            "components": [
                {"id": "plate", "kind": "plate", "operation": "add", "dimensions": {"length": 60, "width": 20, "thickness": 8}},
            ],
            "features": [
                {
                    "id": "hole",
                    "kind": "hole",
                    "target": "plate",
                    "relation": {"type": "attached_to_face", "target": "plate", "face": "top"},
                    "pattern": {"type": "linear", "count": 3, "spacing": 15, "axis": "x"},
                    "parameters": {"diameter": 4, "depth": "through"},
                },
                {"id": "cb", "kind": "counterbore", "target": "hole", "relation": rel, "parameters": {"diameter": 8, "depth": 3}},
            ],
        }
        if extra_groups:
            part["groups"] = extra_groups
        return {"printspecVersion": "0.2.0", "units": "mm", "part": part}

    assert validate_printspec(spec({"targetInstance": 1})) == {"valid": True, "errors": []}
    assert (
        "feature cb relation targetInstance 5 is out of bounds for hole's pattern (3 instance(s))"
        in " ".join(validate_printspec(spec({"targetInstance": 5}))["errors"])
    )
    assert (
        "feature cb relation targetInstance is only valid when target is patterned: plate"
        in " ".join(validate_printspec(spec({"target": "plate", "targetInstance": 0}))["errors"])
    )
    grp = [{"id": "grp", "memberIds": ["plate"], "pattern": {"type": "linear", "count": 2, "spacing": 40, "axis": "x"}}]
    assert (
        "feature cb relation targetInstance is not supported for a group target: grp"
        in " ".join(validate_printspec(spec({"target": "grp", "targetInstance": 0}, grp))["errors"])
    )


def test_composable_part_revolved_profile_schema_validates():
    # revolved_profile is brepjs-only (no Python generator support for
    # composable_part), so Python's job is just schema validation, checked
    # here for parity with the TypeScript generator tests in
    # tests/typescript/printspec.test.js.
    def spec(points, extra_dims=None):
        dims = {"points": points}
        if extra_dims:
            dims.update(extra_dims)
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "revolved_profile test",
                "components": [
                    {"id": "pulley", "kind": "revolved_profile", "operation": "add", "dimensions": dims}
                ],
            },
        }

    solid_points = [
        {"radius": 5, "z": 0},
        {"radius": 10, "z": 10},
        {"radius": 0, "z": 10},
        {"radius": 0, "z": 0},
    ]
    assert validate_printspec(spec(solid_points)) == {"valid": True, "errors": []}
    assert validate_printspec(spec(solid_points, {"sweepAngle": 90})) == {"valid": True, "errors": []}

    ring_points = [
        {"radius": 12, "z": 3},
        {"radius": 15, "z": 6},
        {"radius": 12, "z": 9},
        {"radius": 9, "z": 6},
    ]
    assert validate_printspec(spec(ring_points)) == {"valid": True, "errors": []}

    negative_radius = [dict(p) for p in solid_points]
    negative_radius[0]["radius"] = -5
    assert validate_printspec(spec(negative_radius))["valid"] is False


def test_composable_part_profile_curve_schema_validates():
    # extruded_profile/revolved_profile points support an optional `curve`
    # (arc or Bezier) describing the edge to the next point. Curve geometry
    # itself is only actually built by the TypeScript brepjs generator, so
    # Python's job is schema validation, checked here for parity with the
    # TypeScript generator tests in tests/typescript/printspec.test.js.
    def extruded_spec(points):
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "curve test",
                "components": [
                    {
                        "id": "bulged",
                        "kind": "extruded_profile",
                        "operation": "add",
                        "dimensions": {"points": points, "height": 5},
                    }
                ],
            },
        }

    arc_points = [
        {"x": 0, "y": 0},
        {"x": 10, "y": 0},
        {"x": 10, "y": 10, "curve": {"type": "arc", "through": {"x": 5, "y": 15}}},
        {"x": 0, "y": 10},
    ]
    assert validate_printspec(extruded_spec(arc_points)) == {"valid": True, "errors": []}

    bezier_points = [dict(p) for p in arc_points]
    bezier_points[2] = dict(bezier_points[2])
    bezier_points[2]["curve"] = {"type": "bezier", "controlPoints": [{"x": 5, "y": 20}]}
    assert validate_printspec(extruded_spec(bezier_points)) == {"valid": True, "errors": []}

    spline_points = [dict(p) for p in arc_points]
    spline_points[2] = dict(spline_points[2])
    spline_points[2]["curve"] = {
        "type": "spline",
        "through": [{"x": 3, "y": 18}, {"x": 7, "y": 18}],
    }
    assert validate_printspec(extruded_spec(spline_points)) == {"valid": True, "errors": []}

    def revolve_spec(points):
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "curve revolve test",
                "components": [
                    {"id": "hub", "kind": "revolved_profile", "operation": "add", "dimensions": {"points": points}}
                ],
            },
        }

    revolve_arc_points = [
        {"radius": 5, "z": 0, "curve": {"type": "arc", "through": {"radius": 8, "z": 5}}},
        {"radius": 10, "z": 10},
        {"radius": 0, "z": 10},
        {"radius": 0, "z": 0},
    ]
    assert validate_printspec(revolve_spec(revolve_arc_points)) == {"valid": True, "errors": []}

    revolve_spline_points = [dict(p) for p in revolve_arc_points]
    revolve_spline_points[0] = dict(revolve_spline_points[0])
    revolve_spline_points[0]["curve"] = {"type": "spline", "through": [{"radius": 8, "z": 5}]}
    assert validate_printspec(revolve_spec(revolve_spline_points)) == {"valid": True, "errors": []}


def test_composable_part_loft_profile_schema_validates():
    # loft_profile is brepjs-only (no Python generator support for
    # composable_part), so Python's job is just schema validation, checked
    # here for parity with the TypeScript generator tests in
    # tests/typescript/printspec.test.js.
    def spec(profiles):
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "loft_profile test",
                "components": [
                    {
                        "id": "adapter",
                        "kind": "loft_profile",
                        "operation": "add",
                        "dimensions": {"profiles": profiles},
                    }
                ],
            },
        }

    square = [{"x": -5, "y": -5}, {"x": 5, "y": -5}, {"x": 5, "y": 5}, {"x": -5, "y": 5}]
    bigger_square = [{"x": -10, "y": -10}, {"x": 10, "y": -10}, {"x": 10, "y": 10}, {"x": -10, "y": 10}]
    assert validate_printspec(spec([{"points": square, "z": 0}, {"points": bigger_square, "z": 10}])) == {
        "valid": True,
        "errors": [],
    }

    # A single profile is rejected (nothing to loft to).
    assert validate_printspec(spec([{"points": square, "z": 0}]))["valid"] is False

    # Mismatched vertex counts (a hexagon on top of a square) are allowed.
    hexagon = [
        {"x": -8.660254, "y": -5},
        {"x": 0, "y": -10},
        {"x": 8.660254, "y": -5},
        {"x": 8.660254, "y": 5},
        {"x": 0, "y": 10},
        {"x": -8.660254, "y": 5},
    ]
    assert validate_printspec(spec([{"points": square, "z": 0}, {"points": hexagon, "z": 15}])) == {
        "valid": True,
        "errors": [],
    }


def test_composable_part_threaded_post_and_nut_example_validates():
    spec = read(Path("examples/composable/threaded-post-and-nut.json"))
    assert validate_printspec(spec) == {"valid": True, "errors": []}


def test_composable_part_thread_feature_semantic_checks():
    # thread is brepjs-only (no Python generator support for composable_part),
    # so Python's job is the same shared semantic validation TypeScript's
    # generator test in tests/typescript/printspec.test.js also checks.
    def spec(target_kind, mode, extra_params=None, target_dims=None, hole_params=None):
        components = [
            {
                "id": "a",
                "kind": target_kind,
                "operation": "add",
                "dimensions": target_dims
                or {
                    "cylinder": {"diameter": 12, "height": 10},
                    "boss": {"diameter": 12, "height": 10},
                    "tube": {"outerDiameter": 18, "innerDiameter": 12, "height": 10},
                    "box": {"length": 20, "width": 20, "height": 10},
                }[target_kind],
            }
        ]
        features = []
        target = "a"
        if hole_params is not None:
            features.append(
                {"id": "h", "kind": "hole", "target": "a", "parameters": hole_params}
            )
            target = "h"
        params = {"pitch": 2, "height": 6, "mode": mode}
        params.update(extra_params or {})
        features.append({"id": "t", "kind": "thread", "target": target, "parameters": params})
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "thread test",
                "components": components,
                "features": features,
            },
        }

    # Valid: external thread on a cylinder, internal thread on a tube's own bore.
    assert validate_printspec(spec("cylinder", "external"))["valid"] is True
    assert validate_printspec(spec("tube", "internal"))["valid"] is True

    # Valid: internal thread stacked on a hole feature, like counterbore/countersink.
    assert validate_printspec(
        spec("box", "internal", hole_params={"diameter": 6, "depth": 8})
    )["valid"] is True

    # Invalid: external thread on a box (no outer cylindrical surface).
    errors = " ".join(validate_printspec(spec("box", "external"))["errors"])
    assert "feature t (thread, external) target a is a box, which has no outer surface to thread" in errors

    # Invalid: internal thread targeting a cylinder directly (no bore of its own).
    errors = " ".join(validate_printspec(spec("cylinder", "internal"))["errors"])
    assert "feature t (thread, internal) target a is a cylinder, which has no inner bore to thread" in errors

    # Invalid: crest must be less than toothHalfWidth.
    errors = " ".join(
        validate_printspec(
            spec("cylinder", "external", extra_params={"toothHalfWidth": 0.5, "crest": 0.5})
        )["errors"]
    )
    assert "feature t (thread) crest must be less than toothHalfWidth (0.5 >= 0.5)" in errors

    # Invalid: thread height exceeds the target component's own height.
    errors = " ".join(
        validate_printspec(spec("cylinder", "external", extra_params={"height": 20}))["errors"]
    )
    assert "feature t (thread) height exceeds target a height (20 > 10)" in errors

    # Invalid: thread height exceeds a stacked hole feature's own depth.
    errors = " ".join(
        validate_printspec(
            spec(
                "box",
                "internal",
                extra_params={"height": 20},
                hole_params={"diameter": 6, "depth": 8},
            )
        )["errors"]
    )
    assert "feature t (thread) height exceeds target h's hole depth (20 > 8)" in errors


def test_composable_part_gooseneck_cable_guide_example_validates():
    spec = read(Path("examples/composable/gooseneck-cable-guide.json"))
    assert validate_printspec(spec) == {"valid": True, "errors": []}


def test_composable_part_orifice_plate_with_oring_groove_example_validates():
    spec = read(Path("examples/composable/orifice-plate-with-oring-groove.json"))
    assert validate_printspec(spec) == {"valid": True, "errors": []}


def test_composable_part_swept_profile_schema_validates():
    # swept_profile is brepjs-only (no Python generator support for
    # composable_part), so Python's job is the same shared semantic
    # validation TypeScript's generator test in tests/typescript/printspec.test.js
    # also checks.
    profile = [{"x": -2, "y": -2}, {"x": 2, "y": -2}, {"x": 2, "y": 2}, {"x": -2, "y": 2}]

    def spec(path):
        return {
            "printspecVersion": "0.2.0",
            "units": "mm",
            "part": {
                "type": "composable_part",
                "label": "swept_profile test",
                "components": [
                    {
                        "id": "channel",
                        "kind": "swept_profile",
                        "operation": "add",
                        "dimensions": {"profile": profile, "path": path},
                    }
                ],
            },
        }

    # Valid: first segment parallel to Z, then a bend.
    assert validate_printspec(
        spec([{"x": 0, "y": 0, "z": 0}, {"x": 0, "y": 0, "z": 10}, {"x": 10, "y": 0, "z": 10}])
    ) == {"valid": True, "errors": []}

    # Invalid: first segment not parallel to Z (moves in X too).
    errors = " ".join(
        validate_printspec(
            spec([{"x": 0, "y": 0, "z": 0}, {"x": 10, "y": 0, "z": 10}])
        )["errors"]
    )
    assert (
        "component channel (swept_profile) path's first two points must differ only in z" in errors
    )

    # Invalid: two consecutive identical path points.
    errors = " ".join(
        validate_printspec(
            spec(
                [
                    {"x": 0, "y": 0, "z": 0},
                    {"x": 0, "y": 0, "z": 10},
                    {"x": 0, "y": 0, "z": 10},
                ]
            )
        )["errors"]
    )
    assert (
        "component channel (swept_profile) path has two consecutive identical points at index 1"
        in errors
    )

    # Invalid: a single-point path (nothing to sweep along) is rejected at the schema level.
    assert validate_printspec(spec([{"x": 0, "y": 0, "z": 0}]))["valid"] is False


def test_corner_radius_chamfer_fillet_warnings_match_actual_support():
    families = [
        ("spacer-block.four-hole.json", "spacer-block.schema.json"),
        ("round-spacer.basic.json", "round-spacer.schema.json"),
        ("electronics-standoff.m3.json", "electronics-standoff.schema.json"),
        ("cable-comb.usb.json", "cable-comb.schema.json"),
        ("cable-clip.basic.json", "cable-clip.schema.json"),
        ("wall-mount-bracket.basic.json", "wall-mount-bracket.schema.json"),
        ("l-bracket.basic.json", "l-bracket.schema.json"),
        ("project-enclosure-tray.basic.json", "project-enclosure-tray.schema.json"),
        ("rounded-rectangular-plate.basic.json", "rounded-rectangular-plate.schema.json"),
    ]
    for file, schema_file in families:
        props = read(Path("schemas") / schema_file)["properties"]["parameters"]["properties"]
        s = read(Path("examples/part-families") / file)
        expect_chamfer_warning = "chamfer" in props
        # Only rounded_rectangular_plate actually implements cornerRadius.
        expect_corner_radius_warning = file != "rounded-rectangular-plate.basic.json"
        if expect_chamfer_warning:
            s["part"]["parameters"]["chamfer"] = {"distance": 0.5}
        s["part"]["parameters"]["cornerRadius"] = 1
        for generate in (generate_openscad, generate_cadquery):
            w = " ".join(generate(s)["warnings"])
            if expect_chamfer_warning:
                assert "chamfer requested but not implemented" in w, f"{file} chamfer"
            if expect_corner_radius_warning:
                assert "cornerRadius requested but not implemented" in w, f"{file} cornerRadius"
            else:
                assert "cornerRadius requested but not implemented" not in w, file


def test_validate_printspec_narrows_a_recognized_part_type_to_just_its_own_schema():
    # part.type is a valid composable_part discriminator, but this
    # component's position is missing y/z (both required on Point3D).
    # Before narrowing, jsonschema's oneOf over part-family.schema.json (13
    # types) + composable-part.schema.json reported one generic, useless
    # "is not valid under any of the given schemas" message with no detail
    # at all; narrowing by part.type should report the two real errors from
    # composable-part.schema.json itself instead.
    spec = {
        "printspecVersion": "0.2.0",
        "units": "mm",
        "part": {
            "type": "composable_part",
            "label": "narrowing test",
            "components": [
                {
                    "id": "a",
                    "kind": "box",
                    "operation": "add",
                    "dimensions": {"length": 10, "width": 10, "height": 10},
                    "position": {"x": 1},
                }
            ],
        },
    }
    result = validate_printspec(spec)
    assert result["valid"] is False
    assert len(result["errors"]) == 2, result["errors"]
    for e in result["errors"]:
        assert "position" in e and "required property" in e
    # Same narrowing directly against validate_composable_part_spec
    # (unaffected by this change, since it never went through the part-level
    # oneOf) for parity confirmation -- paths differ only by the "/part"
    # prefix, since that call validates spec["part"] directly rather than
    # the whole spec.
    part_only_result = validate_composable_part_spec(spec["part"])
    assert [e[len("/part") :] for e in result["errors"]] == part_only_result["errors"]


def test_validate_printspec_and_validate_part_family_spec_narrow_the_same_way():
    # round_spacer's innerDiameter must be less than outerDiameter, but
    # that's a semantic check (unaffected here); this is a schema-level
    # mistake (missing required "height") that should only ever produce
    # round_spacer-specific errors, not a failure for every other family
    # branch too.
    bad_part = {
        "type": "round_spacer",
        "label": "narrowing test",
        "parameters": {"outerDiameter": 10, "innerDiameter": 4},
    }
    family_result = validate_part_family_spec(bad_part)
    assert family_result["valid"] is False
    assert all("height" in e for e in family_result["errors"]), family_result["errors"]
    printspec_result = validate_printspec(
        {"printspecVersion": "0.2.0", "units": "mm", "part": bad_part}
    )
    assert printspec_result["valid"] is False
    assert [e[len("/part") :] for e in printspec_result["errors"]] == family_result["errors"]


def test_python_cli_commands():
    env = {**os.environ, "PYTHONPATH": "packages/python"}
    for args in [
        ["validate", "examples/part-families/rounded-rectangular-plate.basic.json"],
        ["to-openscad", "examples/part-families/round-spacer.basic.json"],
        ["to-cadquery", "examples/part-families/electronics-standoff.m3.json"],
        ["bom", "examples/projects/simple-enclosure-project.json", "--format", "markdown"],
    ]:
        r = subprocess.run(
            [sys.executable, "-m", "printspec.cli", *args],
            cwd=root,
            text=True,
            capture_output=True,
            env=env,
            timeout=20,
        )
        assert r.returncode == 0, args + [r.stderr]
        assert r.stdout or r.stderr
    bad = subprocess.run(
        [
            sys.executable,
            "-m",
            "printspec.cli",
            "validate",
            "tests/fixtures/invalid/round-spacer-inner-too-large.json",
        ],
        cwd=root,
        text=True,
        capture_output=True,
        env=env,
        timeout=20,
    )
    assert bad.returncode == 1 and "invalid" in bad.stderr
    malformed = root / "tests/fixtures/invalid-json.tmp.json"
    malformed.write_text("{bad json")
    try:
        r = subprocess.run(
            [sys.executable, "-m", "printspec.cli", "validate", str(malformed)],
            cwd=root,
            text=True,
            capture_output=True,
            env=env,
            timeout=20,
        )
        assert r.returncode == 1
        assert "invalid-json.tmp.json" in r.stderr
        assert "parse error" in r.stderr
    finally:
        malformed.unlink(missing_ok=True)


def test_python_cli_version_commands():
    for args in [["--version"], ["version"]]:
        r = subprocess.run(
            [sys.executable, "-m", "printspec.cli", *args],
            cwd=root,
            text=True,
            capture_output=True,
            env={**os.environ, "PYTHONPATH": "packages/python"},
            timeout=20,
        )
        assert r.returncode == 0
        assert "printspec 0.2.0" in r.stdout


def test_python_cli_friendly_user_errors(tmp_path):
    env = {**os.environ, "PYTHONPATH": "packages/python"}
    help_result = subprocess.run(
        [sys.executable, "-m", "printspec.cli", "--help"],
        cwd=root,
        text=True,
        capture_output=True,
        env=env,
        timeout=20,
    )
    assert help_result.returncode == 0
    assert "usage: printspec" in help_result.stdout

    bad_command = subprocess.run(
        [sys.executable, "-m", "printspec.cli", "wat"],
        cwd=root,
        text=True,
        capture_output=True,
        env=env,
        timeout=20,
    )
    assert bad_command.returncode == 1
    assert "invalid choice" in bad_command.stderr or "error:" in bad_command.stderr
    assert "Traceback" not in bad_command.stderr

    missing = subprocess.run(
        [sys.executable, "-m", "printspec.cli", "validate", "does-not-exist.json"],
        cwd=root,
        text=True,
        capture_output=True,
        env=env,
        timeout=20,
    )
    assert missing.returncode == 1
    assert "does-not-exist.json" in missing.stderr
    assert "read error" in missing.stderr
    assert "Traceback" not in missing.stderr

    malformed = tmp_path / "invalid-json.tmp.json"
    malformed.write_text("{bad json", encoding="utf8")
    invalid = subprocess.run(
        [sys.executable, "-m", "printspec.cli", "validate", str(malformed)],
        cwd=root,
        text=True,
        capture_output=True,
        env=env,
        timeout=20,
    )
    assert invalid.returncode == 1
    assert "invalid-json.tmp.json" in invalid.stderr
    assert "parse error" in invalid.stderr
    assert "Traceback" not in invalid.stderr


def test_python_form_metadata_helpers_and_cli():
    from printspec import get_part_family_form_metadata, list_part_families

    families = list_part_families()
    assert any(
        f["type"] == "rounded_rectangular_plate" and f["generatorSupported"] for f in families
    )
    meta = get_part_family_form_metadata("rounded_rectangular_plate")
    assert [f["name"] for f in meta["fields"][:4]] == [
        "length",
        "width",
        "thickness",
        "cornerRadius",
    ]
    assert meta["fields"][0]["unit"] == "mm"
    assert get_part_family_form_metadata("spacer_block")["partType"] == "spacer_block"
    import pytest

    with pytest.raises(ValueError):
        get_part_family_form_metadata("missing")
    r = subprocess.run(
        [sys.executable, "-m", "printspec.cli", "form-metadata", "rounded_rectangular_plate"],
        cwd=root,
        text=True,
        capture_output=True,
        env={**os.environ, "PYTHONPATH": "packages/python"},
        timeout=20,
    )
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["partType"] == "rounded_rectangular_plate"
    r = subprocess.run(
        [sys.executable, "-m", "printspec.cli", "list-part-families"],
        cwd=root,
        text=True,
        capture_output=True,
        env={**os.environ, "PYTHONPATH": "packages/python"},
        timeout=20,
    )
    assert r.returncode == 0, r.stderr
    assert any(f["type"] == "spacer_block" for f in json.loads(r.stdout))


def test_python_bundle_helpers_and_zip(tmp_path):
    from printspec import create_bundle, write_bundle_to_directory, write_bundle_to_zip

    b = create_bundle(spec, {"includePartCad": True})
    assert b["supported"]
    paths = [f["path"] for f in b["files"]]
    assert paths == sorted(paths)
    assert "printspec.json" in paths and "cad/model.scad" in paths and "cad/model.py" in paths
    assert (
        json.loads(next(f["content"] for f in b["files"] if f["path"] == "bundle-manifest.json"))[
            "kind"
        ]
        == "part"
    )
    out = tmp_path / "bundle"
    write_bundle_to_directory(b, out)
    assert (out / "README.md").exists() and (out / "cad/model.py").exists()
    import zipfile

    import pytest

    with pytest.raises(ValueError):
        write_bundle_to_directory(
            {
                "supported": True,
                "files": [{"path": "../evil", "content": "x", "mediaType": "text/plain"}],
                "warnings": [],
            },
            tmp_path / "bad",
            overwrite=True,
        )
    z = tmp_path / "bundle.zip"
    write_bundle_to_zip(b, z)
    with zipfile.ZipFile(z) as zz:
        assert "bundle-manifest.json" in zz.namelist()


def test_python_project_bundle_and_cli(tmp_path):
    b = create_bundle(project, {"includePartCad": True})
    paths = [f["path"] for f in b["files"]]
    assert (
        "bom/bom.md" in paths and "partcad.yaml" in paths and "parts/base/printspec.json" in paths
    )
    assert len(b["warnings"]) >= 2
    env = {**os.environ, "PYTHONPATH": "packages/python"}
    out = tmp_path / "cli-bundle"
    z = tmp_path / "cli-bundle.zip"
    r = subprocess.run(
        [
            sys.executable,
            "-m",
            "printspec.cli",
            "bundle",
            "examples/part-families/rounded-rectangular-plate.basic.json",
            "--output",
            str(out),
            "--zip",
            str(z),
            "--overwrite",
        ],
        cwd=root,
        text=True,
        capture_output=True,
        env=env,
        timeout=20,
    )
    assert r.returncode == 0, r.stderr
    assert (out / "bundle-manifest.json").exists() and z.exists()
    assert "wrote" in r.stdout
