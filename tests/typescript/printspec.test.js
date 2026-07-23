import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  validatePrintSpec,
  validatePartFamilySpec,
  validateComposablePartSpec,
  extractBom,
  bomToMarkdown,
  bomToCsv,
  bomToSupplierOrderList,
  generateOpenScad,
  generateCadQuery,
  generateBrepJs,
  normalizePrintSpec,
} from "../../packages/typescript/dist/index.js";
const root = path.resolve("../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const norm = (s) =>
  s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd() + "\n";
const spec = read(
  "examples/part-families/rounded-rectangular-plate.basic.json",
);
const project = read("examples/projects/simple-enclosure-project.json");
test("shared valid fixtures pass", () => {
  for (const f of fs
    .readdirSync(path.join(root, "tests/fixtures/valid"))
    .filter((f) => f.endsWith(".json"))) {
    const r = validatePrintSpec(read("tests/fixtures/valid/" + f));
    assert.equal(r.valid, true, `${f}: ${r.errors.join("; ")}`);
  }
});
test("shared invalid fixtures fail", () => {
  for (const f of fs
    .readdirSync(path.join(root, "tests/fixtures/invalid"))
    .filter((f) => f.endsWith(".json"))) {
    assert.equal(
      validatePrintSpec(read("tests/fixtures/invalid/" + f)).valid,
      false,
      f,
    );
  }
});
test("normalization does not mutate and defaults holes", () => {
  const input = structuredClone(spec);
  const out = normalizePrintSpec(input);
  assert.deepEqual(input, spec);
  assert.equal(out.units, "mm");
});
test("bom helpers work", () => {
  const bom = extractBom(project);
  assert.equal(bom[0].quantity, 4);
  assert.match(bomToMarkdown(bom), /lid_screws/);
  assert.match(bomToCsv(bom), /91292A112/);
  assert.match(bomToSupplierOrderList(bom), /mcmaster/);
});
test("top-level hardware quantity accepts a whole-valued float, matching JSON's number type", () => {
  // Number.isInteger(5) is true regardless of whether the literal was
  // written 5 or 5.0 -- JS has no separate int/float representation -- so
  // a hardware item authored as quantity: 5.0 in JSON must validate cleanly
  // here, the same as quantity: 5. Mirrors the Python-side test in
  // tests/python/test_printspec.py (a real parity gap was found and fixed:
  // Python's semantic check previously used isinstance(quantity, int),
  // which rejects a JSON 5.0 that parses to a Python float).
  const withHardware = (quantity) => ({
    ...structuredClone(spec),
    hardware: [{ id: "screw_1", kind: "screw", quantity }],
  });
  assert.deepEqual(validatePrintSpec(withHardware(5.0)), {
    valid: true,
    errors: [],
  });
  assert.equal(validatePrintSpec(withHardware(0.5)).valid, false);
});
test("generators validate and emit safe deterministic code", () => {
  assert.match(generateOpenScad(spec).code, /difference/);
  const cq = generateCadQuery(spec).code;
  assert.match(cq, /part =/);
  assert.doesNotMatch(cq, /export|subprocess|os\.|open\(/);
  const brep = generateBrepJs(spec).code;
  assert.match(brep, /export default \(\) => part;/);
  assert.doesNotMatch(brep, /require\(|process\.|child_process|eval\(/);
  const bad = structuredClone(spec);
  bad.part.parameters.cornerRadius = 999;
  const res = generateOpenScad(bad);
  assert.equal(res.supported, false);
  assert.match(res.message, /Validation failed/);
  assert.equal(generateBrepJs(bad).supported, false);
});
test("generator snapshots match fixtures", () => {
  const items = [
    [
      "rounded-rectangular-plate.basic",
      "examples/part-families/rounded-rectangular-plate.basic.json",
    ],
    [
      "spacer-block.four-hole",
      "examples/part-families/spacer-block.four-hole.json",
    ],
    ["round-spacer.basic", "examples/part-families/round-spacer.basic.json"],
    [
      "electronics-standoff.m3",
      "examples/part-families/electronics-standoff.m3.json",
    ],
  ];
  for (const [name, file] of items) {
    const s = read(file);
    assert.equal(
      norm(generateOpenScad(s).code),
      norm(
        fs.readFileSync(
          path.join(root, `tests/fixtures/generated/openscad/${name}.scad`),
          "utf8",
        ),
      ),
    );
    assert.equal(
      norm(generateCadQuery(s).code),
      norm(
        fs.readFileSync(
          path.join(root, `tests/fixtures/generated/cadquery/${name}.py`),
          "utf8",
        ),
      ),
    );
    assert.equal(
      norm(generateBrepJs(s).code),
      norm(
        fs.readFileSync(
          path.join(root, `tests/fixtures/generated/brepjs/${name}.brep.ts`),
          "utf8",
        ),
      ),
    );
  }
});
test("round spacer chamfer is built in OpenSCAD; standoff semantic validation", () => {
  const s = read("examples/part-families/round-spacer.basic.json");
  s.part.parameters.chamfer = { distance: 0.5 };
  const scad = generateOpenScad(s);
  // OpenSCAD now builds a whole-part chamfer, so it no longer warns for it.
  assert.deepEqual(scad.warnings, []);
  assert.match(scad.code, /rotate_extrude\(\$fn = 64\) polygon/);
  assert.match(scad.code, /chamfer = 0.5;/);
  // CadQuery does not implement chamfer yet, so it still warns.
  assert.deepEqual(generateCadQuery(s).warnings, [
    "chamfer requested but not implemented",
  ]);
  // A targeted chamfer is not built yet and still warns in OpenSCAD.
  const targeted = read("examples/part-families/round-spacer.basic.json");
  targeted.part.parameters.chamfer = { distance: 0.5, target: "top" };
  assert.deepEqual(generateOpenScad(targeted).warnings, [
    "chamfer requested but not implemented",
  ]);
  assert.equal(
    validatePrintSpec(
      read("tests/fixtures/invalid/electronics-standoff-base-too-small.json"),
    ).valid,
    false,
  );
});
test("spacer_block chamfer builds a hulled chamfered box in OpenSCAD", () => {
  const s = read("examples/part-families/spacer-block.four-hole.json");
  s.part.parameters.chamfer = { distance: 0.5 };
  const scad = generateOpenScad(s);
  assert.deepEqual(scad.warnings, []);
  assert.match(scad.code, /module chamfered_box\(\) \{/);
  assert.match(scad.code, /hull\(\) \{/);
  assert.match(scad.code, /chamfered_box\(\);/);
});
test("round spacer fillet is built in OpenSCAD via a rotate_extrude arc", () => {
  const s = read("examples/part-families/round-spacer.basic.json");
  s.part.parameters.fillet = { radius: 0.5 };
  const scad = generateOpenScad(s);
  assert.deepEqual(scad.warnings, []);
  assert.match(scad.code, /fillet = 0.5;/);
  assert.match(scad.code, /rotate_extrude\(\$fn = 64\) polygon\(concat\(/);
  assert.match(scad.code, /sin\(i\*90\/8\)/);
  // Chamfer wins when both are requested; the fillet then still warns.
  const both = read("examples/part-families/round-spacer.basic.json");
  both.part.parameters.chamfer = { distance: 0.5 };
  both.part.parameters.fillet = { radius: 0.5 };
  const rb = generateOpenScad(both);
  assert.deepEqual(rb.warnings, ["fillet requested but not implemented"]);
  assert.doesNotMatch(rb.code, /fillet =/);
  // CadQuery does not implement fillet yet, so it still warns.
  assert.match(
    generateCadQuery(s).warnings.join(" "),
    /fillet requested but not implemented/,
  );
});
test("rounded rectangular plate chamfer and fillet build hulled profiled columns", () => {
  const ch = read(
    "examples/part-families/rounded-rectangular-plate.basic.json",
  );
  ch.part.parameters.chamfer = { distance: 0.5 };
  const rc = generateOpenScad(ch);
  assert.deepEqual(rc.warnings, []);
  assert.match(rc.code, /chamfer = 0.5;/);
  assert.match(
    rc.code,
    /rotate_extrude\(\$fn = 32\) polygon\(\[\[0, 0\], \[corner_radius - chamfer, 0\]/,
  );
  const fi = read(
    "examples/part-families/rounded-rectangular-plate.basic.json",
  );
  fi.part.parameters.fillet = { radius: 0.5 };
  const rf = generateOpenScad(fi);
  assert.deepEqual(rf.warnings, []);
  assert.match(rf.code, /fillet = 0.5;/);
  assert.match(rf.code, /rotate_extrude\(\$fn = 32\) polygon\(concat\(/);
});
test("l_bracket cuts holes and slots on both legs via the schema's holes/slots arrays", () => {
  const s = read("examples/part-families/l-bracket.holes-and-slots.json");
  assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] });
  for (const generate of [generateOpenScad, generateCadQuery, generateBrepJs]) {
    const r = generate(s);
    assert.equal(r.supported, true);
    assert.doesNotMatch(r.code, /holeDiameter|holesPerLeg/);
    assert.match(r.code, /3\.2/);
  }
  assert.match(generateOpenScad(s).code, /rotate\(\[0, 90, 0\]\)/);
  assert.match(
    generateCadQuery(s).code,
    /rotate\(\(0, 0, 0\), \(0, 1, 0\), 90\)/,
  );
  assert.match(generateBrepJs(s).code, /rotate\(90, \{ axis: \[0, 1, 0\] \}\)/);
  const withYAxis = structuredClone(s);
  withYAxis.part.parameters.holes.push({
    x: 5,
    y: 0,
    diameter: 3,
    depth: "through",
    axis: "y",
  });
  assert.match(
    generateOpenScad(withYAxis).warnings.join(" "),
    /axis 'y' is not implemented for l_bracket/,
  );
});
test("cable_clip cuts mounting holes from the schema's mountingHoles array", () => {
  const s = read("examples/part-families/cable-clip.with-mount-hole.json");
  assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] });
  for (const generate of [generateOpenScad, generateCadQuery, generateBrepJs]) {
    const r = generate(s);
    assert.equal(r.supported, true);
    assert.doesNotMatch(r.code, /mountHoleDiameter/);
    assert.match(r.code, /3\.2/);
  }
});
test("composable-part dimension constraints validate already-authored numbers, not solve for them", () => {
  const base = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "constraints test",
      components: [
        {
          id: "plate",
          kind: "plate",
          operation: "add",
          dimensions: { length: 40, width: 40, thickness: 4 },
        },
        {
          id: "boss",
          kind: "cylinder",
          operation: "add",
          dimensions: { diameter: 6, height: 5 },
        },
      ],
      features: [
        {
          id: "hole",
          kind: "hole",
          target: "plate",
          parameters: { diameter: 8, depth: "through" },
        },
      ],
    },
  };
  const withConstraint = (c) => ({
    ...base,
    part: { ...base.part, constraints: [c] },
  });

  // Passes: hole diameter (8) >= boss diameter (6) + 0.4 margin.
  assert.deepEqual(
    validatePrintSpec(
      withConstraint({
        type: "dimension",
        id: "clearance",
        left: { ref: "hole", key: "diameter" },
        operator: ">=",
        right: { ref: "boss", key: "diameter" },
        margin: 0.4,
      }),
    ),
    { valid: true, errors: [] },
  );

  // Fails: margin too large for the actual numbers (8 >= 6 + 5 is false).
  assert.match(
    validatePrintSpec(
      withConstraint({
        type: "dimension",
        id: "clearance",
        left: { ref: "hole", key: "diameter" },
        operator: ">=",
        right: { ref: "boss", key: "diameter" },
        margin: 5,
      }),
    ).errors.join(" "),
    /constraint clearance failed: 8 >= 6 \+ 5 is false/,
  );

  // Unknown ref and unknown/non-numeric key are both reported distinctly.
  assert.match(
    validatePrintSpec(
      withConstraint({
        type: "dimension",
        id: "clearance",
        left: { ref: "nonexistent", key: "diameter" },
        operator: ">=",
        right: 1,
      }),
    ).errors.join(" "),
    /constraint clearance left references unknown component\/feature: nonexistent/,
  );
  assert.match(
    validatePrintSpec(
      withConstraint({
        type: "dimension",
        id: "clearance",
        left: { ref: "boss", key: "notarealkey" },
        operator: ">=",
        right: 1,
      }),
    ).errors.join(" "),
    /constraint clearance left references non-numeric or missing dimension "notarealkey" on boss/,
  );

  // Literal-vs-literal (no refs at all) works too.
  assert.deepEqual(
    validatePrintSpec(
      withConstraint({ type: "dimension", left: 5, operator: "<", right: 10 }),
    ),
    { valid: true, errors: [] },
  );

  // No `id`: the constraint's array index is used in the message instead.
  assert.match(
    validatePrintSpec(
      withConstraint({ type: "dimension", left: 10, operator: "<", right: 5 }),
    ).errors.join(" "),
    /constraint #0 failed: 10 < 5 is false/,
  );

  // A feature's `parameters` (not just a component's `dimensions`) can be
  // referenced too.
  assert.deepEqual(
    validatePrintSpec(
      withConstraint({
        type: "dimension",
        left: { ref: "hole", key: "diameter" },
        operator: "==",
        right: 8,
      }),
    ),
    { valid: true, errors: [] },
  );
});
test("composable-part groups validate ids, memberIds, and relation targets", () => {
  const strip = read("examples/composable/cable-tie-anchor-strip.json");
  assert.deepEqual(validatePrintSpec(strip), { valid: true, errors: [] });
  const mount = read(
    "examples/composable/vented-sensor-mount-with-standoffs.json",
  );
  assert.deepEqual(validatePrintSpec(mount), { valid: true, errors: [] });

  const unknownMember = structuredClone(strip);
  unknownMember.part.groups[0].memberIds.push("nonexistent");
  assert.match(
    validatePrintSpec(unknownMember).errors.join(" "),
    /group post_left_assembly memberIds references unknown component: nonexistent/,
  );

  const dupGroupId = structuredClone(strip);
  dupGroupId.part.groups[1].id = dupGroupId.part.groups[0].id;
  assert.match(
    validatePrintSpec(dupGroupId).errors.join(" "),
    /duplicate group id/,
  );

  const unknownGroupTarget = structuredClone(strip);
  unknownGroupTarget.part.groups[1].relation.target = "ghost";
  assert.match(
    validatePrintSpec(unknownGroupTarget).errors.join(" "),
    /group post_right_assembly relation target does not exist: ghost/,
  );

  // A component's relation may target a group id (not just another component).
  const targetsGroup = structuredClone(mount);
  targetsGroup.part.components.push({
    id: "reference_marker",
    kind: "box",
    operation: "add",
    dimensions: { length: 1, width: 1, height: 1 },
    relation: { type: "centered_on", target: "standoffs" },
  });
  assert.deepEqual(validatePrintSpec(targetsGroup), {
    valid: true,
    errors: [],
  });

  // relation.offset was removed in favor of position as the sole offset.
  const withOffset = structuredClone(strip);
  withOffset.part.groups[1].relation.offset = { x: 1, y: 0, z: 0 };
  assert.equal(validatePrintSpec(withOffset).valid, false);

  // Component/feature/group ids are checked as one combined namespace, since
  // target resolution treats them as one, even though each category is also
  // checked for internal duplicates separately.
  const crossCategoryDupe = structuredClone(strip);
  crossCategoryDupe.part.groups[0].id = "post_left";
  assert.match(
    validatePrintSpec(crossCategoryDupe).errors.join(" "),
    /id used by more than one component\/feature\/group: post_left/,
  );
});
test("composable-part rejects a cycle formed only by feature target chains, with no explicit relation", () => {
  // Regression test: a feature's bare `target` (used as an implicit
  // position anchor and CSG cut scope even without an explicit `relation`)
  // previously wasn't part of the cycle-detection graph, so two features
  // that `target` each other passed validation cleanly but crashed the
  // generator with a stack overflow instead of failing validation cleanly.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "feature target cycle test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
      ],
      features: [
        { id: "f1", kind: "hole", target: "f2", parameters: { diameter: 2 } },
        { id: "f2", kind: "hole", target: "f1", parameters: { diameter: 2 } },
      ],
    },
  };
  assert.match(
    validatePrintSpec(spec).errors.join(" "),
    /relation cycle detected: f1 -> f2 -> f1/,
  );
});
const COMPOSABLE_EXAMPLES = [
  "adapter-plate-with-two-hole-patterns",
  "angled-sensor-mount-with-inherited-rotation",
  "cable-tie-anchor-strip",
  "clearance-fit-boss-and-cap",
  "corner-counterbore-with-target-instance",
  "d-shaft-with-intersect-flat",
  "dome-with-ellipsoid-cap",
  "electronics-base-with-standoffs",
  "flared-hub-with-curved-revolve-profile",
  "fully-rounded-electronics-case",
  "gooseneck-cable-guide",
  "grommet-with-torus-ring",
  "id-tag-with-embossed-and-engraved-text",
  "knob-with-sphere-cap",
  "l-shaped-bracket-custom-profile",
  "latch-arm-with-clearance-constraint",
  "open-top-enclosure-shell",
  "orifice-plate-with-oring-groove",
  "pulley-with-revolved-profile",
  "quad-standoff-mounting-plate",
  "rounded-corner-bracket-with-arc-profile",
  "rounded-top-chamfered-lid",
  "small-bracket-with-ribs",
  "square-to-round-duct-adapter",
  "threaded-post-and-nut",
  "vented-sensor-mount-with-standoffs",
  "wedge-ramp-with-countersunk-mount",
];
test("composable-part brepjs generator matches snapshots for every example fixture", () => {
  for (const name of COMPOSABLE_EXAMPLES) {
    const s = read(`examples/composable/${name}.json`);
    assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] }, name);
    const brep = generateBrepJs(s);
    assert.equal(brep.supported, true, name);
    assert.doesNotMatch(
      brep.code,
      /require\(|process\.|child_process|eval\(/,
      name,
    );
    assert.equal(
      norm(brep.code),
      norm(
        fs.readFileSync(
          path.join(
            root,
            `tests/fixtures/generated/brepjs/composable/${name}.brep.ts`,
          ),
          "utf8",
        ),
      ),
      name,
    );
  }
});
// A string-snapshot comparison only checks a generator's output against
// itself; it can't catch a generated module that's syntactically broken or
// misuses the brepjs API (wrong arg counts/types, missing unwrap()) --
// exactly how a real bug (composable_part's `wedge` extruding along the
// wrong axis, producing a silently zero-volume solid) slipped past every
// existing test until it was executed against the real brepjs+occt-wasm
// kernel by hand. `runBrepJsAgainstStub` actually imports and runs generated
// code against a minimal stub `brepjs` (tests/fixtures/brepjs-stub/brepjs.mjs)
// that checks call shapes without doing real geometry, so that class of
// mistake fails a test automatically instead of only surfacing by hand.
let brepjsStubDirPromise;
async function brepjsStubDir() {
  if (!brepjsStubDirPromise) {
    brepjsStubDirPromise = (async () => {
      const tmpBase = fs.mkdtempSync(
        path.join(os.tmpdir(), "printspec-brepjs-stub-"),
      );
      const stubDir = path.join(tmpBase, "node_modules", "brepjs");
      fs.mkdirSync(stubDir, { recursive: true });
      fs.copyFileSync(
        path.join(root, "tests/fixtures/brepjs-stub/brepjs.mjs"),
        path.join(stubDir, "index.mjs"),
      );
      fs.writeFileSync(
        path.join(stubDir, "package.json"),
        JSON.stringify({
          name: "brepjs",
          version: "0.0.0-stub",
          type: "module",
          main: "index.mjs",
          // 'brepjs/text' (loadFont/sketchText, used by the text feature)
          // is a real brepjs subpath -- map it to the same stub file, which
          // exports both the main and text APIs from one place.
          exports: { ".": "./index.mjs", "./text": "./index.mjs" },
        }),
      );
      return tmpBase;
    })();
  }
  return brepjsStubDirPromise;
}
let runCounter = 0;
async function runBrepJsAgainstStub(code) {
  const tmpBase = await brepjsStubDir();
  const modPath = path.join(tmpBase, `mod_${runCounter++}.mjs`);
  fs.writeFileSync(modPath, code);
  const mod = await import(pathToFileURL(modPath).href);
  return mod.default();
}
after(async () => {
  if (brepjsStubDirPromise)
    fs.rmSync(await brepjsStubDirPromise, { recursive: true, force: true });
});
test("composable-part brepjs generator output actually executes against a stub brepjs implementation", async () => {
  for (const name of COMPOSABLE_EXAMPLES) {
    const s = read(`examples/composable/${name}.json`);
    const code = generateBrepJs(s).code;
    const result = await runBrepJsAgainstStub(code);
    assert.ok(
      result && typeof result === "object",
      `${name}: default export should return a shape`,
    );
  }
});
test("all 10 core part-family brepjs generator outputs actually execute against a stub brepjs implementation", async () => {
  for (const f of fs
    .readdirSync(path.join(root, "examples/part-families"))
    .filter((f) => f.endsWith(".json"))) {
    const s = read("examples/part-families/" + f);
    const brep = generateBrepJs(s);
    if (!brep.supported) continue;
    const result = await runBrepJsAgainstStub(brep.code);
    assert.ok(
      result && typeof result === "object",
      `${f}: default export should return a shape`,
    );
  }
});
test("composable-part brepjs generator resolves feature cuts against a grouped component's final position", () => {
  // Regression test: a feature targeting a component that belongs to a
  // transforming group must cut at that component's final (post-group)
  // world position, not its pre-group authoring-space position -- both
  // posts previously produced an identical, wrongly-placed cut at the
  // origin instead of at their actual (mirrored) locations.
  const s = read("examples/composable/cable-tie-anchor-strip.json");
  const code = generateBrepJs(s).code;
  const leftCut = code.match(
    /const featureCut_tie_hole_left_\d+ = ([^\n]+);/,
  )?.[1];
  const rightCut = code.match(
    /const featureCut_tie_hole_right_\d+ = ([^\n]+);/,
  )?.[1];
  assert.ok(leftCut, "left cut expression found");
  assert.ok(rightCut, "right cut expression found");
  assert.match(leftCut, /-18, 0, 3/);
  assert.match(rightCut, /18, 0, 3/);
  assert.notEqual(leftCut, rightCut);
});
test("composable-part brepjs generator rotates a relation anchor by the target's transforming-group rotation", () => {
  // Regression test: a relation anchoring to a component that belongs to a
  // *rotating* transforming group (a group with its own `rotation`, not
  // just `position`) must rotate the local anchor offset (for example
  // on_top_of's [0,0,height]) by the group's rotation too, not just the
  // target's own (pre-group) rotation -- otherwise the anchor point doesn't
  // land on the target's actual, group-rotated top face. Hand-derived: "a"
  // (a 10x10x10 box) sits in a group rotated 90 degrees about Y and moved
  // to x=100, so a's own top-face-center anchor ([0,0,10] locally) rotates
  // to world [10,0,0] before the group's position is added, landing at
  // [110, 0, ~0] -- not [100, 0, 10], which is what the un-rotated anchor
  // (the pre-fix behavior) would have produced.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "group rotation anchor test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
        {
          id: "b",
          kind: "box",
          operation: "add",
          dimensions: { length: 2, width: 2, height: 2 },
          relation: { type: "on_top_of", target: "a" },
        },
      ],
      groups: [
        {
          id: "g",
          memberIds: ["a"],
          rotation: { x: 0, y: 90, z: 0 },
          position: { x: 100, y: 0, z: 0 },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const code = generateBrepJs(spec).code;
  const bPlacement = code.match(/const comp_b_\d+ = ([^\n]+);/)?.[1];
  assert.ok(bPlacement, "b placement expression found");
  const translateCalls = [
    ...bPlacement.matchAll(/\.translate\(\[([^\]]+)\]\)/g),
  ];
  assert.ok(translateCalls.length > 0, "translate call found");
  const translateArgs = translateCalls.at(-1)[1];
  const [tx, ty, tz] = translateArgs.split(",").map(Number);
  assert.equal(tx, 110);
  assert.equal(ty, 0);
  assert.ok(Math.abs(tz) < 1e-9, `expected tz near 0, got ${tz}`);
});
test("composable-part brepjs generator builds a real tapered gusset for rib, not a box approximation", () => {
  // Regression test: `rib` previously emitted a plain box (with a warning
  // that it was an approximation, since the schema has no taper angle) --
  // it now builds a real right-triangular-prism gusset via the same
  // wireLoop/line/face/extrude technique already proven for `wedge`,
  // real-kernel-verified elsewhere to match the triangular-prism volume
  // formula (0.5 * length * height * thickness) exactly.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "rib taper test",
      components: [
        {
          id: "rib",
          kind: "rib",
          operation: "add",
          dimensions: { length: 20, height: 20, thickness: 3 },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  assert.doesNotMatch(result.code, /box\(20, 3, 20\)|box\(20, 20, 3\)/);
  assert.match(result.code, /wireLoop\(\[/);
  assert.match(result.code, /line\(\[-10, -1\.5, 0\], \[10, -1\.5, 0\]\)/);
  assert.match(result.code, /line\(\[10, -1\.5, 0\], \[-10, -1\.5, 20\]\)/);
  assert.match(result.code, /line\(\[-10, -1\.5, 20\], \[-10, -1\.5, 0\]\)/);
  assert.match(result.code, /\[0, 3, 0\]/);
});
test("composable-part brepjs generator builds an extruded_profile from an arbitrary polygon, centered on its bounding box", () => {
  // extruded_profile generalizes the wireLoop/line/face/extrude technique
  // proven for wedge/rib to an arbitrary author-supplied polygon, extruded
  // along Z (a plain-number height is correct here, unlike wedge/rib, since
  // the profile already lies in the XY plane -- see the case's own
  // comment). Real-kernel-verified elsewhere (both windings, convex and
  // concave) to always produce the correct positive volume regardless of
  // point order, so no winding normalization is needed.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "extruded_profile test",
      components: [
        {
          id: "bracket",
          kind: "extruded_profile",
          operation: "add",
          dimensions: {
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 10 },
              { x: 10, y: 10 },
              { x: 10, y: 20 },
              { x: 0, y: 20 },
            ],
            height: 5,
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  assert.match(result.code, /wireLoop\(\[/);
  // Bounding box is [0,20]x[0,20], center (10,10) -- points must be emitted
  // already shifted by -10,-10, not the raw as-authored coordinates.
  assert.match(result.code, /line\(\[-10, -10, 0\], \[10, -10, 0\]\)/);
  assert.match(result.code, /line\(\[10, -10, 0\], \[10, 0, 0\]\)/);
  assert.match(result.code, /line\(\[0, 10, 0\], \[-10, 10, 0\]\)/);
  // Plain-number height, no [0,h,0] direction vector (contrast with wedge/rib).
  assert.match(result.code, /\)\)\)\), 5\)\)/);
});
test("composable-part brepjs generator resolves relations and connectivity against an extruded_profile's real bounding box", () => {
  // Unlike rib/wedge, extruded_profile has a well-defined AABB (derived
  // from its points), so relations/features/the connectivity check all
  // work against it the same as any box-like kind.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "extruded_profile relations test",
      components: [
        {
          id: "bracket",
          kind: "extruded_profile",
          operation: "add",
          dimensions: {
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            height: 4,
          },
        },
        {
          id: "boss",
          kind: "boss",
          operation: "add",
          dimensions: { diameter: 4, height: 6 },
          relation: { type: "on_top_of", target: "bracket" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  // on_top_of a 4mm-tall bracket anchors the boss at z=4.
  assert.match(
    result.code,
    /shape\(cylinder\(2, 6\)\)\.translate\(\[0, 0, 4\]\)/,
  );

  // A component with a gap from the extruded_profile must still trip the
  // connectivity check.
  const disconnected = structuredClone(spec);
  disconnected.part.components[1].relation = undefined;
  disconnected.part.components[1].position = { x: 500, y: 0, z: 0 };
  assert.match(
    generateBrepJs(disconnected).warnings.join(" "),
    /single connected part/,
  );
});
test("composable-part extruded_profile and revolved_profile points support curved (arc/Bezier/spline) segments", () => {
  // A point's optional `curve` makes the edge to the *next* point an arc
  // (brepjs's threePointArc(start, through, end)), a Bezier curve (brepjs's
  // bezier([start, ...controlPoints, end])), or a smooth B-spline through
  // one or more points (brepjs's bsplineApprox([start, ...through, end]))
  // instead of a straight line. Real-kernel-verified elsewhere
  // (examples/composable/rounded-corner-bracket-with-arc-profile.json and
  // flared-hub-with-curved-revolve-profile.json) to match hand-derived
  // volumes exactly; the spline case is real-kernel-verified to genuinely
  // curve through its through points (an asymmetric bulge produces a
  // volume well above the straight-line baseline), not degenerate to a
  // straight edge.
  const arcSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "arc profile test",
      components: [
        {
          id: "bulged",
          kind: "extruded_profile",
          operation: "add",
          dimensions: {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              {
                x: 10,
                y: 10,
                curve: { type: "arc", through: { x: 5, y: 15 } },
              },
              { x: 0, y: 10 },
            ],
            height: 5,
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(arcSpec), { valid: true, errors: [] });
  const arcResult = generateBrepJs(arcSpec);
  assert.deepEqual(arcResult.warnings, []);
  // Bounding box (for centering) must include the arc's through point (up
  // to y=15), not just the 4 main vertices (which alone would only reach
  // y=10) -- otherwise centering would be wrong and relations/connectivity
  // would use too small a footprint.
  assert.match(
    arcResult.code,
    /threePointArc\(\[5, 2\.5, 0\], \[0, 7\.5, 0\], \[-5, 2\.5, 0\]\)/,
  );

  const bezierSpec = structuredClone(arcSpec);
  bezierSpec.part.components[0].dimensions.points[2].curve = {
    type: "bezier",
    controlPoints: [{ x: 5, y: 20 }],
  };
  assert.deepEqual(validatePrintSpec(bezierSpec), { valid: true, errors: [] });
  const bezierResult = generateBrepJs(bezierSpec);
  assert.deepEqual(bezierResult.warnings, []);
  assert.match(
    bezierResult.code,
    /unwrap\(bezier\(\[\[5, [\d.-]+, 0\], \[0, [\d.-]+, 0\], \[-5, [\d.-]+, 0\]\]\)\)/,
  );

  // Same curve types work on revolved_profile, in the (radius, z) half-plane.
  const revolveArcSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "arc revolve profile test",
      components: [
        {
          id: "hub",
          kind: "revolved_profile",
          operation: "add",
          dimensions: {
            points: [
              {
                radius: 5,
                z: 0,
                curve: { type: "arc", through: { radius: 8, z: 5 } },
              },
              { radius: 10, z: 10 },
              { radius: 0, z: 10 },
              { radius: 0, z: 0 },
            ],
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(revolveArcSpec), {
    valid: true,
    errors: [],
  });
  const revolveArcResult = generateBrepJs(revolveArcSpec);
  assert.deepEqual(revolveArcResult.warnings, []);
  assert.match(
    revolveArcResult.code,
    /threePointArc\(\[5, 0, 0\], \[8, 0, 5\], \[10, 0, 10\]\)/,
  );

  // spline works the same way on extruded_profile, through 2 points.
  const splineSpec = structuredClone(arcSpec);
  splineSpec.part.components[0].dimensions.points[2].curve = {
    type: "spline",
    through: [
      { x: 3, y: 18 },
      { x: 7, y: 18 },
    ],
  };
  assert.deepEqual(validatePrintSpec(splineSpec), { valid: true, errors: [] });
  const splineResult = generateBrepJs(splineSpec);
  assert.deepEqual(splineResult.warnings, []);
  assert.match(
    splineResult.code,
    /unwrap\(bsplineApprox\(\[\[5, [\d.-]+, 0\], \[[\d.-]+, [\d.-]+, 0\], \[[\d.-]+, [\d.-]+, 0\], \[-5, [\d.-]+, 0\]\]\)\)/,
  );

  // spline also works on revolved_profile, in the (radius, z) half-plane.
  const revolveSplineSpec = structuredClone(revolveArcSpec);
  revolveSplineSpec.part.components[0].dimensions.points[0].curve = {
    type: "spline",
    through: [{ radius: 8, z: 5 }],
  };
  assert.deepEqual(validatePrintSpec(revolveSplineSpec), {
    valid: true,
    errors: [],
  });
  const revolveSplineResult = generateBrepJs(revolveSplineSpec);
  assert.deepEqual(revolveSplineResult.warnings, []);
  assert.match(
    revolveSplineResult.code,
    /unwrap\(bsplineApprox\(\[\[5, 0, 0\], \[8, 0, 5\], \[10, 0, 10\]\]\)\)/,
  );
});
test("composable-part brepjs generator implements loft_profile via brepjs's real loft()", () => {
  // loft_profile blends between 2+ cross-sectional profiles at different Z
  // heights, via brepjs's real loft(wires) -- confirmed to return an
  // already-capped, valid solid directly (not an open shell needing manual
  // capping). Real-kernel-verified elsewhere to match a hand-derived
  // frustum volume exactly (matching vertex counts) and, by symmetry, a
  // 3-profile "barrel" shape exactly; also verified valid (though with no
  // simple closed-form volume) for mismatched vertex counts (see
  // examples/composable/square-to-round-duct-adapter.json, which also
  // combines loft with a true circular profile built from `curve` arcs).
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "loft_profile test",
      components: [
        {
          id: "adapter",
          kind: "loft_profile",
          operation: "add",
          dimensions: {
            profiles: [
              {
                points: [
                  { x: -5, y: -5 },
                  { x: 5, y: -5 },
                  { x: 5, y: 5 },
                  { x: -5, y: 5 },
                ],
                z: 0,
              },
              {
                points: [
                  { x: -10, y: -10 },
                  { x: 10, y: -10 },
                  { x: 10, y: 10 },
                  { x: -10, y: 10 },
                ],
                z: 10,
              },
            ],
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  // Each profile is its own wire (not a face -- loft() takes wires
  // directly), each centered on its own local origin independently, at its
  // own (Z-shifted) height.
  assert.match(
    result.code,
    /unwrap\(loft\(\[\n\s*unwrap\(wireLoop\(\[\n\s*line\(\[-5, -5, 0\], \[5, -5, 0\]\),/,
  );
  assert.match(result.code, /line\(\[-10, -10, 10\], \[10, -10, 10\]\)/);

  // A single profile is rejected at the schema level (nothing to loft to).
  const singleProfile = structuredClone(spec);
  singleProfile.part.components[0].dimensions.profiles.length = 1;
  assert.equal(validatePrintSpec(singleProfile).valid, false);

  // A relation and a feature both resolve against loft_profile's derived
  // AABB (max half-extent across all profiles, Z span across all profiles'
  // z values) the same as extruded_profile/revolved_profile.
  const withHole = structuredClone(spec);
  withHole.part.features = [
    {
      id: "bore",
      kind: "hole",
      target: "adapter",
      relation: { type: "centered_on", target: "adapter" },
      parameters: { diameter: 3, depth: "through" },
    },
  ];
  assert.deepEqual(validatePrintSpec(withHole), { valid: true, errors: [] });
  assert.deepEqual(generateBrepJs(withHole).warnings, []);
});
test("composable-part brepjs generator implements thread via brepjs's real thread()", () => {
  // thread builds a real helical screw-thread ridge via brepjs's thread().
  // Its radius is never author-specified -- it's derived directly from the
  // target's own diameter/outerDiameter/innerDiameter, so the ridge always
  // sits flush with the surface it belongs to (real-kernel-verified: a rod
  // or bore built at exactly the same radius as the thread's own root
  // radius fuses/cuts cleanly, no margin trick needed unlike text). See
  // examples/composable/threaded-post-and-nut.json.
  const baseSpec = (targetKind, targetDims, mode, extraParams) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "thread test",
      components: [
        { id: "a", kind: targetKind, operation: "add", dimensions: targetDims },
      ],
      features: [
        {
          id: "t",
          kind: "thread",
          target: "a",
          parameters: { pitch: 2, height: 6, mode, ...extraParams },
        },
      ],
    },
  });

  // External thread on a boss: radius = diameter / 2, fused (added), not cut.
  const external = baseSpec("boss", { diameter: 12, height: 10 }, "external");
  assert.deepEqual(validatePrintSpec(external), { valid: true, errors: [] });
  const extResult = generateBrepJs(external);
  assert.deepEqual(extResult.warnings, []);
  assert.match(
    extResult.code,
    /unwrap\(thread\(\{ radius: 6, pitch: 2, height: 6 \}\)\)/,
  );
  assert.match(
    extResult.code,
    /shape\(comp_a_\d+\)\.fuse\(featureCut_t_\d+\)\.val/,
  );

  // Internal thread on a tube's own bore: radius = innerDiameter / 2, cut
  // (not fused), with brepjs's inward:true so the tooth points toward the
  // axis (correct for cutting a groove into a bore wall).
  const internal = baseSpec(
    "tube",
    { outerDiameter: 18, innerDiameter: 12, height: 10 },
    "internal",
  );
  assert.deepEqual(validatePrintSpec(internal), { valid: true, errors: [] });
  const intResult = generateBrepJs(internal);
  assert.deepEqual(intResult.warnings, []);
  assert.match(
    intResult.code,
    /unwrap\(thread\(\{ radius: 6, pitch: 2, height: 6, inward: true \}\)\)/,
  );
  assert.match(
    intResult.code,
    /shape\(comp_a_\d+\)\.cut\(featureCut_t_\d+\)\.val/,
  );

  // Internal thread stacked on a hole feature (like counterbore/countersink
  // already stack on a hole): radius derived from the hole's own diameter.
  const stackedOnHole = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "thread on hole test",
      components: [
        {
          id: "block",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 10 },
        },
      ],
      features: [
        {
          id: "bore",
          kind: "hole",
          target: "block",
          parameters: { diameter: 8, depth: 8 },
        },
        {
          id: "tap",
          kind: "thread",
          target: "bore",
          parameters: { pitch: 1, height: 6, mode: "internal" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(stackedOnHole), {
    valid: true,
    errors: [],
  });
  const stackedResult = generateBrepJs(stackedOnHole);
  assert.deepEqual(stackedResult.warnings, []);
  assert.match(
    stackedResult.code,
    /unwrap\(thread\(\{ radius: 4, pitch: 1, height: 6, inward: true \}\)\)/,
  );

  // Rejected: external thread targeting a kind with no outer cylindrical
  // surface (a box).
  const badTarget = baseSpec(
    "box",
    { length: 20, width: 20, height: 10 },
    "external",
  );
  const badTargetErrors = validatePrintSpec(badTarget).errors.join(" ");
  assert.match(
    badTargetErrors,
    /feature t \(thread, external\) target a is a box, which has no outer surface to thread/,
  );

  // Rejected: internal thread targeting a cylinder directly (no bore of its own).
  const badMode = baseSpec(
    "cylinder",
    { diameter: 12, height: 10 },
    "internal",
  );
  const badModeErrors = validatePrintSpec(badMode).errors.join(" ");
  assert.match(
    badModeErrors,
    /feature t \(thread, internal\) target a is a cylinder, which has no inner bore to thread/,
  );

  // Rejected: crest must be less than toothHalfWidth.
  const badCrest = baseSpec("boss", { diameter: 12, height: 10 }, "external", {
    toothHalfWidth: 0.5,
    crest: 0.5,
  });
  const badCrestErrors = validatePrintSpec(badCrest).errors.join(" ");
  assert.match(
    badCrestErrors,
    /feature t \(thread\) crest must be less than toothHalfWidth \(0\.5 >= 0\.5\)/,
  );

  // Rejected: thread height exceeds the target's own axial dimension.
  const tooTall = baseSpec("boss", { diameter: 12, height: 10 }, "external", {
    height: 20,
  });
  const tooTallErrors = validatePrintSpec(tooTall).errors.join(" ");
  assert.match(
    tooTallErrors,
    /feature t \(thread\) height exceeds target a height \(20 > 10\)/,
  );
});
test("composable-part brepjs generator implements swept_profile via brepjs's real sweep()", () => {
  // swept_profile sweeps an arbitrary closed cross-section along a 3D path
  // via brepjs's real sweep(profile, spine, options). Real-kernel testing
  // found brepjs does NOT auto-orient the profile to the spine's own
  // tangent, so the path's first segment must run parallel to Z (matching
  // the profile's fixed XY-plane orientation) -- semantic validation
  // enforces this. transitionMode: "round" is always passed: real-kernel
  // testing found the default (no options) and "right" (sharp miter) both
  // produce invalid geometry at a bend, while "round" is valid (and doesn't
  // change a single-segment straight sweep's exact volume either). Unlike
  // extruded_profile, the profile is NOT centered on its own bounding box --
  // real-kernel testing confirmed its own literal coordinates matter (no
  // auto-snap to the spine's start). See
  // examples/composable/gooseneck-cable-guide.json.
  const profile = [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
  ];
  const spec = (path) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "swept_profile test",
      components: [
        {
          id: "channel",
          kind: "swept_profile",
          operation: "add",
          dimensions: { profile, path },
        },
      ],
    },
  });

  // Straight path (first, and only, segment along Z).
  const straight = spec([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 10 },
  ]);
  assert.deepEqual(validatePrintSpec(straight), { valid: true, errors: [] });
  const straightResult = generateBrepJs(straight);
  assert.deepEqual(straightResult.warnings, []);
  assert.match(
    straightResult.code,
    /unwrap\(sweep\(\n\s*unwrap\(wireLoop\(\[\n\s*line\(\[-2, -2, 0\], \[2, -2, 0\]\),/,
  );
  assert.match(
    straightResult.code,
    /unwrap\(wire\(\[\n\s*line\(\[0, 0, 0\], \[0, 0, 10\]\),\n\s*\]\)\),\n\s*\{ transitionMode: "round" \}/,
  );

  // Bent path (a bracket-like L-bend after the first Z segment); path[0] is
  // shifted to local origin, so every subsequent point is relative to it.
  const bent = spec([
    { x: 5, y: 0, z: 5 },
    { x: 5, y: 0, z: 15 },
    { x: 15, y: 0, z: 15 },
  ]);
  assert.deepEqual(validatePrintSpec(bent), { valid: true, errors: [] });
  const bentResult = generateBrepJs(bent);
  assert.deepEqual(bentResult.warnings, []);
  assert.match(
    bentResult.code,
    /line\(\[0, 0, 0\], \[0, 0, 10\]\),\n\s*line\(\[0, 0, 10\], \[10, 0, 10\]\),/,
  );

  // Rejected: first segment not parallel to Z.
  const badFirstSegment = spec([
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 10 },
  ]);
  const badFirstSegmentErrors =
    validatePrintSpec(badFirstSegment).errors.join(" ");
  assert.match(
    badFirstSegmentErrors,
    /component channel \(swept_profile\) path's first two points must differ only in z/,
  );

  // Rejected: two consecutive identical path points (zero-length segment).
  const duplicatePoint = spec([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 10 },
    { x: 0, y: 0, z: 10 },
  ]);
  const duplicatePointErrors =
    validatePrintSpec(duplicatePoint).errors.join(" ");
  assert.match(
    duplicatePointErrors,
    /component channel \(swept_profile\) path has two consecutive identical points at index 1/,
  );

  // swept_profile has no derived AABB (like rib/wedge) -- targeting it with
  // a relation produces the same "no anchor" fallback, not a crash.
  const asTarget = structuredClone(straight);
  asTarget.part.components.push({
    id: "cap",
    kind: "box",
    operation: "add",
    dimensions: { length: 2, width: 2, height: 2 },
    relation: { type: "on_top_of", target: "channel" },
  });
  assert.deepEqual(validatePrintSpec(asTarget), { valid: true, errors: [] });
  assert.equal(generateBrepJs(asTarget).supported, true);
});
test("composable-part brepjs generator supports isolating one component/feature's own shape via options.isolate", () => {
  // generateBrepJs(spec, { isolate: id }) emits the exact same module (same
  // lines, same warnings) but points the final `export default` at one
  // named component or feature's own resolved shape instead of fusing
  // everything into the whole part -- for inspecting a single piece (its
  // own volume/bounds/validity) via scripts/brepjs-verify or an MCP-style
  // run_program tool, without hand-deriving combined-shape math or
  // authoring a separate throwaway spec that isolates it.
  const spec = read("examples/composable/threaded-post-and-nut.json");
  const whole = generateBrepJs(spec);
  assert.equal(whole.supported, true);

  // Isolating a component: same body, only the final line differs.
  const isolatePost = generateBrepJs(spec, { isolate: "post" });
  assert.equal(isolatePost.supported, true);
  assert.deepEqual(isolatePost.warnings, whole.warnings);
  assert.match(
    isolatePost.code,
    /export default \(\) => comp_post_fuse_\d+;\n$/,
  );
  // Every line before the final export is identical between the whole-part
  // and isolated code -- isolating only changes the tail (the whole-part
  // version has an extra "const part_N = ...fuse..." line the isolated
  // version skips entirely, plus each version's own blank line + export).
  const wholeLines = whole.code.trim().split("\n");
  const isolateLines = isolatePost.code.trim().split("\n");
  assert.deepEqual(isolateLines.slice(0, -2), wholeLines.slice(0, -3));

  // Isolating a feature (not just a component): the thread ridge alone.
  const isolateThread = generateBrepJs(spec, { isolate: "post_thread" });
  assert.equal(isolateThread.supported, true);
  assert.match(
    isolateThread.code,
    /export default \(\) => featureCut_post_thread_\d+;\n$/,
  );

  // Isolating a group: fuses just that group's own live members' shapes,
  // not the group's transform wrapper (a group has no shape of its own).
  const groupSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "isolate group test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 5 },
        },
        {
          id: "b",
          kind: "box",
          operation: "add",
          dimensions: { length: 5, width: 5, height: 5 },
          relation: { type: "on_top_of", target: "a" },
        },
      ],
      groups: [{ id: "g", memberIds: ["a", "b"] }],
    },
  };
  assert.deepEqual(validatePrintSpec(groupSpec), { valid: true, errors: [] });
  const isolateGroup = generateBrepJs(groupSpec, { isolate: "g" });
  assert.equal(isolateGroup.supported, true);
  assert.match(
    isolateGroup.code,
    /export default \(\) => shape\(comp_a_\d+\)\.fuse\(comp_b_\d+\)\.val;\n$/,
  );

  // Rejected: an id that doesn't exist, or a feature kind (shell/fillet/
  // chamfer) with no standalone shape of its own to isolate.
  const missing = generateBrepJs(spec, { isolate: "nope" });
  assert.equal(missing.supported, false);
  assert.match(
    missing.message,
    /no component, feature, or group with a standalone shape found for id "nope"/,
  );

  const shellSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "isolate shell test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
      ],
      features: [
        {
          id: "hollow",
          kind: "shell",
          target: "a",
          parameters: { thickness: 1, openFaces: ["top"] },
        },
      ],
    },
  };
  const isolateShell = generateBrepJs(shellSpec, { isolate: "hollow" });
  assert.equal(isolateShell.supported, false);
  assert.match(
    isolateShell.message,
    /shell\/fillet\/chamfer features modify their target's shape in place/,
  );

  // isolate is rejected outright for non-composable_part specs.
  const plateSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "rounded_rectangular_plate",
      label: "isolate non-composable test",
      parameters: { length: 20, width: 20, thickness: 4, cornerRadius: 2 },
    },
  };
  const isolatePlate = generateBrepJs(plateSpec, { isolate: "anything" });
  assert.equal(isolatePlate.supported, false);
  assert.match(
    isolatePlate.message,
    /isolate is only supported for composable_part specs/,
  );
});
test("composable-part brepjs generator applies inheritRotation to a component's own geometry", () => {
  // A component resting on_top_of a rotated target, with no rotation of its
  // own, previously stayed axis-aligned -- correctly anchored, but not
  // flush with the target's tipped surface. inheritRotation: true composes
  // the target's rotation onto the dependent's own placement, oriented
  // before it's translated to its resolved (already-correct) position.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "component inheritRotation test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 10, height: 4 },
          rotation: { x: 0, y: 45, z: 0 },
        },
        {
          id: "b",
          kind: "box",
          operation: "add",
          dimensions: { length: 4, width: 4, height: 4 },
          relation: { type: "on_top_of", target: "a", inheritRotation: true },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  const bExpr = result.code.match(/const comp_b_\d+ = ([^\n]+);/)?.[1];
  assert.ok(bExpr, "b placement expression found");
  // b's own rotate stage (matching a's 45deg Y rotation) must come before
  // its translate to the resolved anchor position.
  const rotateIdx = bExpr.indexOf("rotate(45, { axis: [0, 1, 0] })");
  const translateIdx = bExpr.lastIndexOf(".translate(");
  assert.ok(rotateIdx >= 0, "inherited rotate stage found");
  assert.ok(
    rotateIdx < translateIdx,
    "rotate must precede the final translate",
  );
});
test("composable-part brepjs generator applies inheritRotation to a feature's cutter, and transitively through a chain", () => {
  // Regression test for a real bug found while building this: a feature (or
  // component) with inheritRotation only picked up its immediate target's
  // *own authored* rotation field, missing any rotation that target itself
  // inherited from *its* relation target -- silently landing at the right
  // anchor point but the wrong orientation, two levels deep. `pad` inherits
  // `support`'s rotation (component-level), and `mount_hole` inherits
  // `pad`'s effective (inherited) rotation (feature-level) -- both need to
  // reflect the same underlying 20deg tilt.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "transitive inheritRotation test",
      components: [
        {
          id: "support",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 30, height: 6 },
          rotation: { x: 20, y: 0, z: 0 },
        },
        {
          id: "pad",
          kind: "box",
          operation: "add",
          dimensions: { length: 16, width: 16, height: 3 },
          relation: {
            type: "on_top_of",
            target: "support",
            inheritRotation: true,
          },
        },
      ],
      features: [
        {
          id: "mount_hole",
          kind: "hole",
          target: "pad",
          relation: {
            type: "centered_on",
            target: "pad",
            inheritRotation: true,
          },
          parameters: { diameter: 3, depth: "through" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  const padExpr = result.code.match(/const comp_pad_\d+ = ([^\n]+);/)?.[1];
  const holeExpr = result.code.match(
    /const featureCut_mount_hole_\d+ = ([^\n]+);/,
  )?.[1];
  assert.ok(padExpr, "pad placement expression found");
  assert.ok(holeExpr, "hole cut expression found");
  // Both must carry the 20deg X rotation inherited from `support`, even
  // though only `support` has an authored `rotation` field.
  assert.match(padExpr, /rotate\(20, \{ axis: \[1, 0, 0\] \}\)/);
  assert.match(holeExpr, /rotate\(20, \{ axis: \[1, 0, 0\] \}\)/);
});
test("composable-part rejects inheritRotation on a group's relation", () => {
  // inheritRotation is only meaningful on a component or feature relation
  // (something with its own rotate-then-translate placement); a group's
  // relation only positions the group as a whole, so inheritRotation there
  // has no well-defined target to apply to.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "group inheritRotation rejection test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
        {
          id: "b",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
      ],
      groups: [
        {
          id: "g",
          memberIds: ["b"],
          relation: { type: "on_top_of", target: "a", inheritRotation: true },
        },
      ],
    },
  };
  assert.match(
    validatePrintSpec(spec).errors.join(" "),
    /group g relation may not set inheritRotation: only valid on a component or feature relation/,
  );
});
test("composable-part brepjs generator scopes a feature's cut to its target component only", () => {
  // Regression test: a feature's cut previously applied to the whole fused
  // assembly, not just its `target` -- so a "through" hole/slot's
  // deliberately oversized cutter could silently bleed into any other
  // component sitting along its axis. Two plates touching edge to edge; a
  // lateral through-hole targeting only plate_a must not touch plate_b at
  // all, even though the cutter's real extent reaches far past both.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "feature cut scoping test",
      components: [
        {
          id: "plate_a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 5 },
        },
        {
          id: "plate_b",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 5 },
          position: { x: 20, y: 0, z: 0 },
        },
      ],
      features: [
        {
          id: "pass_through",
          kind: "hole",
          target: "plate_a",
          position: { x: 0, y: 0, z: 2.5 },
          parameters: { diameter: 4, depth: "through", axis: "x" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  // The cut must apply to plate_a's own component variable specifically...
  assert.match(
    result.code,
    /shape\(comp_plate_a_\d+\)\.cut\(featureCut_pass_through_\d+\)/,
  );
  // ...and plate_b's component variable must never appear as a .cut() base
  // or argument -- only fused in untouched.
  const plateBVar = result.code.match(/const (comp_plate_b_\d+) =/)?.[1];
  assert.ok(plateBVar, "plate_b variable name found");
  assert.doesNotMatch(result.code, new RegExp(`\\.cut\\(${plateBVar}\\)`));
  assert.doesNotMatch(
    result.code,
    new RegExp(`shape\\(${plateBVar}\\)\\.cut\\(`),
  );
  assert.match(result.code, new RegExp(`\\.fuse\\(${plateBVar}\\)`));
});
test("composable-part brepjs generator resolves a stacked feature's cut through to its underlying component", () => {
  // mount_hole_left_cb (a counterbore) targets mount_hole_left (a hole
  // feature, not a component) -- the cut must resolve through that chain to
  // standoff_left, and standoff_right (an unrelated, untargeted component)
  // must never appear as a .cut() base or argument.
  const s = read("examples/composable/vented-sensor-mount-with-standoffs.json");
  const code = generateBrepJs(s).code;
  const rightVar = code.match(/const (comp_standoff_right_\d+) =/)?.[1];
  assert.ok(rightVar, "standoff_right variable name found");
  assert.doesNotMatch(code, new RegExp(`\\.cut\\(${rightVar}\\)`));
  assert.doesNotMatch(code, new RegExp(`shape\\(${rightVar}\\)\\.cut\\(`));
  // Both the hole and the counterbore cut chain onto the same (left) lineage.
  const cutLines = [
    ...code.matchAll(
      /const (comp_standoff_left_cut_\d+) = shape\(([^)]+)\)\.cut\(/g,
    ),
  ];
  assert.equal(
    cutLines.length,
    2,
    "expected two chained cuts on standoff_left",
  );
});
test("composable-part brepjs generator cuts every member when a feature targets a group", () => {
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "feature targets group test",
      components: [
        {
          id: "top",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 5 },
        },
        {
          id: "bottom",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 5 },
          position: { x: 0, y: 0, z: 5 },
        },
      ],
      groups: [{ id: "stack", memberIds: ["top", "bottom"] }],
      features: [
        {
          id: "bolt_hole",
          kind: "hole",
          target: "stack",
          position: { x: 0, y: 0, z: 5 },
          parameters: { diameter: 3, depth: "through" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  assert.match(
    result.code,
    /shape\(comp_top_\d+\)\.cut\(featureCut_bolt_hole_\d+\)/,
  );
  assert.match(
    result.code,
    /shape\(comp_bottom_\d+\)\.cut\(featureCut_bolt_hole_\d+\)/,
  );
});
test("composable-part brepjs generator repeats a whole group's members via a group-level pattern", () => {
  // A group's own `pattern` repeats every member as one rigid unit -- the
  // motivating case: a multi-component cluster (here a standoff + its
  // subtract-cutter mounting hole) authored once and repeated, instead of
  // hand-duplicating each cluster's components at four hand-computed
  // offsets. Real-kernel-verified separately; here just check the
  // generated code fuses 4 instances of both members at the right offsets.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "group pattern test",
      components: [
        {
          id: "standoff",
          kind: "boss",
          operation: "add",
          dimensions: { diameter: 6, height: 8 },
        },
        {
          id: "mount_hole",
          kind: "cylinder",
          operation: "subtract",
          dimensions: { diameter: 3, height: 20 },
          position: { x: 0, y: 0, z: -5 },
          appliesTo: ["standoff"],
        },
      ],
      groups: [
        {
          id: "standoff_cluster",
          memberIds: ["standoff", "mount_hole"],
          pattern: {
            type: "rectangular",
            countX: 2,
            countY: 2,
            spacingX: 40,
            spacingY: 30,
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  assert.equal((result.code.match(/\.fuse\(/g) ?? []).length, 6); // 3 fuses each for standoff and mount_hole
  for (const [x, y] of [
    [-20, -15],
    [-20, 15],
    [20, -15],
    [20, 15],
  ])
    assert.match(result.code, new RegExp(`translate\\(\\[${x}, ${y}, 0\\]\\)`));
});
test("composable-part brepjs generator repeats a feature's own cut when its target is a member of a patterned group", () => {
  // Regression test: a feature (not itself a group member -- features never
  // are) whose `target` is a member of a *patterned* group previously only
  // cut once, at the pattern's center point, instead of once per actual
  // instance of its target -- so most (or, if nothing sits at the exact
  // center, all) of the pattern's instances went un-cut. The feature must
  // now repeat its own cut across the same pattern as its target.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "feature on patterned group member test",
      components: [
        {
          id: "standoff",
          kind: "boss",
          operation: "add",
          dimensions: { diameter: 6, height: 8 },
        },
      ],
      groups: [
        {
          id: "cluster",
          memberIds: ["standoff"],
          pattern: {
            type: "rectangular",
            countX: 2,
            countY: 2,
            spacingX: 40,
            spacingY: 40,
          },
        },
      ],
      features: [
        {
          id: "mount_hole",
          kind: "hole",
          target: "standoff",
          parameters: { diameter: 3, depth: "through" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  const cutExpr = result.code.match(
    /const featureCut_mount_hole_\d+ = ([^\n]+);/,
  )?.[1];
  assert.ok(cutExpr, "feature cut expression found");
  assert.equal(
    (cutExpr.match(/\.fuse\(/g) ?? []).length,
    3,
    "4 instances chained via 3 fuses",
  );
  for (const [x, y] of [
    [-20, -20],
    [-20, 20],
    [20, -20],
    [20, 20],
  ])
    assert.match(cutExpr, new RegExp(`translate\\(\\[${x}, ${y}, 0\\]\\)`));
});
test("composable-part brepjs generator connectivity check accounts for a group's pattern instances", () => {
  // The bounding-box connectivity check must consider *every* instance of a
  // patterned group's members, not just the group's own (pattern-center)
  // resolved position -- otherwise it could wrongly warn about a
  // genuinely-connected part, or wrongly miss a real gap.
  const spec = (groupExtra) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "patterned group connectivity test",
      components: [
        {
          id: "plate",
          kind: "box",
          operation: "add",
          dimensions: { length: 60, width: 60, height: 4 },
        },
        {
          id: "standoff",
          kind: "boss",
          operation: "add",
          dimensions: { diameter: 6, height: 8 },
        },
      ],
      groups: [
        {
          id: "cluster",
          memberIds: ["standoff"],
          pattern: {
            type: "rectangular",
            countX: 2,
            countY: 2,
            spacingX: 40,
            spacingY: 40,
          },
          ...groupExtra,
        },
      ],
    },
  });
  const touching = spec({});
  assert.deepEqual(validatePrintSpec(touching), { valid: true, errors: [] });
  assert.doesNotMatch(
    generateBrepJs(touching).warnings.join(" "),
    /single connected part/,
  );

  const pushedAway = spec({ position: { x: 500, y: 0, z: 0 } });
  assert.match(
    generateBrepJs(pushedAway).warnings.join(" "),
    /single connected part/,
  );
});
test("composable-part brepjs generator expands a feature's own pattern into a fused union of cuts", () => {
  // Regression test: a patterned feature (for example a rectangular bolt
  // pattern of holes) previously only cut a single instance at the
  // pattern's center, silently dropping every other instance -- despite
  // being schema-valid, documented, and producing no warning. The cutter
  // must now be a fused union of one instance per pattern offset.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "feature pattern test",
      components: [
        {
          id: "plate",
          kind: "box",
          operation: "add",
          dimensions: { length: 40, width: 40, height: 4 },
        },
      ],
      features: [
        {
          id: "bolt_circle",
          kind: "hole",
          target: "plate",
          parameters: { diameter: 3, depth: "through" },
          pattern: {
            type: "rectangular",
            countX: 2,
            countY: 2,
            spacingX: 20,
            spacingY: 20,
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  // Four instances at (+-10, +-10), fused pairwise into one cutter (three
  // .fuse() calls chaining the four translated cylinder instances).
  for (const [x, y] of [
    [-10, -10],
    [-10, 10],
    [10, -10],
    [10, 10],
  ])
    assert.match(result.code, new RegExp(`translate\\(\\[${x}, ${y}, 0\\]\\)`));
  assert.equal((result.code.match(/\.fuse\(/g) ?? []).length, 3);
});
test("composable-part brepjs generator warns instead of silently dropping a feature whose target has no add shape", () => {
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "unresolvable feature target test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
        {
          id: "cutter",
          kind: "box",
          operation: "subtract",
          dimensions: { length: 2, width: 2, height: 2 },
        },
      ],
      features: [
        {
          id: "stray",
          kind: "hole",
          target: "cutter",
          parameters: { diameter: 1 },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.match(
    result.warnings.join(" "),
    /feature stray's target does not resolve to any "add" component; the cut was not applied/,
  );
  assert.doesNotMatch(result.code, /featureCut_stray/);
});
test("composable-part brepjs generator warns instead of silently dropping a subtract component that applies to nothing", () => {
  // Regression test: the same silent-no-op gap as the feature case above,
  // but on the sibling subtract-component path. Two ways it can happen: (1)
  // appliesTo names a real component id that's itself subtract-only, never
  // an "add" shape; (2) no appliesTo, and the component was declared before
  // any add component, so the default ("every add declared earlier") is
  // empty -- an easy ordering trap.
  const appliesToOrphan = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "orphan subtract test (appliesTo)",
      components: [
        {
          id: "plate",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 4 },
        },
        {
          id: "notch",
          kind: "box",
          operation: "subtract",
          dimensions: { length: 2, width: 2, height: 2 },
        },
        {
          id: "cutter",
          kind: "box",
          operation: "subtract",
          dimensions: { length: 2, width: 2, height: 2 },
          appliesTo: ["notch"],
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(appliesToOrphan), {
    valid: true,
    errors: [],
  });
  const r1 = generateBrepJs(appliesToOrphan);
  assert.match(
    r1.warnings.join(" "),
    /component cutter \(subtract\) does not apply to any "add" component; the cut was not applied/,
  );
  assert.doesNotMatch(r1.code, /cut_cutter/);

  const declaredBeforeAnyAdd = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "orphan subtract test (declaration order)",
      components: [
        {
          id: "cutter",
          kind: "box",
          operation: "subtract",
          dimensions: { length: 2, width: 2, height: 2 },
        },
        {
          id: "plate",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 4 },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(declaredBeforeAnyAdd), {
    valid: true,
    errors: [],
  });
  const r2 = generateBrepJs(declaredBeforeAnyAdd);
  assert.match(
    r2.warnings.join(" "),
    /component cutter \(subtract\) does not apply to any "add" component; the cut was not applied/,
  );
  assert.doesNotMatch(r2.code, /cut_cutter/);
});
test("composable-part brepjs generator implements sphere, based at Z=0 like every other kind", () => {
  // brepjs's sphere() is centered at its own origin by default, unlike
  // box/cylinder, whose native default already has Z=0 at the base -- the
  // generator must shift it up by its own radius so it follows the same
  // "Z=0 at base, extending in +Z" convention as every other component
  // kind, so relations like on_top_of resolve against it the same way.
  // Real-kernel-verified elsewhere to match a knob's hand-derived combined
  // cylinder+sphere volume exactly.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "sphere test",
      components: [
        {
          id: "stem",
          kind: "cylinder",
          operation: "add",
          dimensions: { diameter: 8, height: 15 },
        },
        {
          id: "knob",
          kind: "sphere",
          operation: "add",
          dimensions: { diameter: 20 },
          relation: { type: "on_top_of", target: "stem" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  // sphere(10) (radius = diameter/2) shifted up by its own radius (10),
  // then translated again to stem's top (Z=15, on_top_of's anchor).
  assert.match(
    result.code,
    /shape\(sphere\(10\)\)\.translate\(\[0, 0, 10\]\)\.val\)\.translate\(\[0, 0, 15\]\)\.val/,
  );
});
test("composable-part brepjs generator implements torus, based at Z=0 like every other kind", () => {
  // torus's dimensions are author-facing (outerDiameter, tubeDiameter --
  // measurements one would actually take of a real ring), derived into
  // brepjs's (majorRadius, minorRadius) form. Like sphere(), brepjs's
  // torus() centers at its own origin by default -- shift up by the minor
  // radius so it follows the same "Z=0 at base" convention as every other
  // kind. Real-kernel-verified elsewhere to match a grommet's hand-derived
  // combined plate+torus volume exactly.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "torus test",
      components: [
        {
          id: "plate",
          kind: "plate",
          operation: "add",
          dimensions: { length: 40, width: 40, thickness: 3 },
        },
        {
          id: "ring",
          kind: "torus",
          operation: "add",
          dimensions: { outerDiameter: 20, tubeDiameter: 6 },
          relation: { type: "on_top_of", target: "plate" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  // majorRadius = (20-6)/2 = 7, minorRadius = 6/2 = 3; shifted up by 3 (own
  // base shift), then translated again to plate's top (Z=3, on_top_of's
  // anchor).
  assert.match(
    result.code,
    /shape\(torus\(7, 3\)\)\.translate\(\[0, 0, 3\]\)\.val\)\.translate\(\[0, 0, 3\]\)\.val/,
  );
});
test("composable-part rejects an inverted torus (tubeDiameter >= outerDiameter)", () => {
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "inverted torus test",
      components: [
        {
          id: "ring",
          kind: "torus",
          operation: "add",
          dimensions: { outerDiameter: 10, tubeDiameter: 20 },
        },
      ],
    },
  };
  assert.match(
    validatePrintSpec(spec).errors.join(" "),
    /component ring \(torus\) tubeDiameter must be less than outerDiameter \(20 >= 10\)/,
  );
  const valid = structuredClone(spec);
  valid.part.components[0].dimensions.tubeDiameter = 3;
  assert.deepEqual(validatePrintSpec(valid), { valid: true, errors: [] });
});
test("composable-part clearance constraint: structural checks are semantic-validation errors, geometric violations are generator warnings", () => {
  // A `clearance` constraint needs each component's fully resolved world
  // position, which only the TypeScript brepjs generator can compute --
  // semantic validation (shared by both languages) only checks that `a`/`b`
  // reference real, geometrically well-defined components, not whether the
  // constraint actually holds.
  const spec = (aPos, minDistance) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "clearance constraint test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
        {
          id: "b",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
          position: aPos,
        },
      ],
      constraints: [
        { type: "clearance", id: "gap", a: "a", b: "b", minDistance },
      ],
    },
  });
  // Structurally valid (both exist, are distinct, have a well-defined AABB)
  // regardless of whether the constraint's minDistance actually holds --
  // semantic validation never resolves position.
  const violated = spec({ x: 10.5, y: 0, z: 0 }, 2);
  assert.deepEqual(validatePrintSpec(violated), { valid: true, errors: [] });
  assert.match(
    generateBrepJs(violated).warnings.join(" "),
    /constraint gap \(clearance\) failed: a\/b are only 0\.5mm apart \(approximate bounding-box check\), less than the required 2mm/,
  );
  // Satisfied: no clearance warning (the connectivity warning is still
  // expected and irrelevant here, since a and b are deliberately not
  // touching in this synthetic test).
  const satisfied = spec({ x: 15, y: 0, z: 0 }, 2);
  assert.deepEqual(validatePrintSpec(satisfied), { valid: true, errors: [] });
  assert.doesNotMatch(
    generateBrepJs(satisfied).warnings.join(" "),
    /clearance\) failed/,
  );

  // Structural errors: unknown ref, self-reference, and a rib/wedge target
  // (no well-defined AABB) are semantic-validation errors, not warnings.
  const unknownRef = spec({ x: 10.5, y: 0, z: 0 }, 2);
  unknownRef.part.constraints[0].b = "nope";
  assert.match(
    validatePrintSpec(unknownRef).errors.join(" "),
    /constraint gap b references unknown component: nope/,
  );
  const selfRef = spec({ x: 10.5, y: 0, z: 0 }, 2);
  selfRef.part.constraints[0].b = "a";
  assert.match(
    validatePrintSpec(selfRef).errors.join(" "),
    /constraint gap a and b must be different components/,
  );
  const ribRef = spec({ x: 10.5, y: 0, z: 0 }, 2);
  ribRef.part.components.push({
    id: "r",
    kind: "rib",
    operation: "add",
    dimensions: { length: 10, height: 5, thickness: 2 },
  });
  ribRef.part.constraints[0].b = "r";
  assert.match(
    validatePrintSpec(ribRef).errors.join(" "),
    /constraint gap b references component r \(kind "rib"\), which has no well-defined bounding box/,
  );
});
test("composable-part brepjs generator implements ellipsoid, based at Z=0 like every other kind", () => {
  // Like sphere()/torus(), brepjs's ellipsoid() centers at its own origin
  // by default -- shift up by its own Z half-length so it follows the same
  // "Z=0 at base" convention as every other kind. ellipsoid is deliberately
  // excluded from the hole/slot/shell/fillet/chamfer footprint/depth bounds
  // checks (FOOTPRINT_DIM/DEPTH_DIM in semantic.ts/semantic.py), the same as
  // rib/wedge, since its X and Y extents can differ and it has no single
  // "footprint" number to check against.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "ellipsoid test",
      components: [
        {
          id: "base",
          kind: "plate",
          operation: "add",
          dimensions: { length: 40, width: 30, thickness: 4 },
        },
        {
          id: "dome",
          kind: "ellipsoid",
          operation: "add",
          dimensions: { lengthX: 30, lengthY: 20, lengthZ: 10 },
          relation: { type: "on_top_of", target: "base" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  // ellipsoid(15, 10, 5) (half-lengths) shifted up by its own Z half-length
  // (5), then translated again to base's top (Z=4, on_top_of's anchor).
  assert.match(
    result.code,
    /shape\(ellipsoid\(15, 10, 5\)\)\.translate\(\[0, 0, 5\]\)\.val\)\.translate\(\[0, 0, 4\]\)\.val/,
  );
});
test("composable-part brepjs generator implements revolved_profile via brepjs's real revolve()", () => {
  // revolved_profile sweeps an arbitrary (radius, z) cross-section around Z
  // -- the "sketch and revolve" operation, unlike extruded_profile's XY
  // footprint. Real-kernel-verified elsewhere (examples/composable/pulley-
  // with-revolved-profile.json) to match a hand-derived conical-frustum
  // volume exactly, both for a full 360-degree sweep and (via Pappus's
  // theorem) a partial sweep and a hollow-ring (torus-like) profile.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "revolved_profile test",
      components: [
        {
          id: "pulley",
          kind: "revolved_profile",
          operation: "add",
          dimensions: {
            points: [
              { radius: 5, z: 0 },
              { radius: 10, z: 10 },
              { radius: 0, z: 10 },
              { radius: 0, z: 0 },
            ],
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  assert.match(
    result.code,
    /unwrap\(revolve\(unwrap\(face\(unwrap\(wireLoop\(\[\n\s*line\(\[5, 0, 0\], \[10, 0, 10\]\),\n\s*line\(\[10, 0, 10\], \[0, 0, 10\]\),\n\s*line\(\[0, 0, 10\], \[0, 0, 0\]\),\n\s*line\(\[0, 0, 0\], \[5, 0, 0\]\),\n\s*\]\)\)\)\)\)\);/,
  );

  // sweepAngle < 360 emits an explicit { angle } option (radians); omitted
  // entirely for the default full 360-degree sweep, matching
  // applyTransform()'s skip-the-default convention elsewhere.
  const partial = structuredClone(spec);
  partial.part.components[0].dimensions.sweepAngle = 90;
  const partialResult = generateBrepJs(partial);
  assert.deepEqual(partialResult.warnings, []);
  assert.match(partialResult.code, /\{ angle: 1\.5707963267948966 \}\)\);/);
  assert.doesNotMatch(generateBrepJs(spec).code, /angle:/);

  // A profile entirely at radius > 0 (never touching the axis) produces a
  // hollow ring instead of a solid -- both are valid uses of the same kind.
  const ring = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "ring test",
      components: [
        {
          id: "ring",
          kind: "revolved_profile",
          operation: "add",
          dimensions: {
            points: [
              { radius: 12, z: 3 },
              { radius: 15, z: 6 },
              { radius: 12, z: 9 },
              { radius: 9, z: 6 },
            ],
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(ring), { valid: true, errors: [] });
  assert.deepEqual(generateBrepJs(ring).warnings, []);

  // Negative radius is rejected at the schema level.
  const negativeRadius = structuredClone(spec);
  negativeRadius.part.components[0].dimensions.points[0].radius = -5;
  assert.equal(validatePrintSpec(negativeRadius).valid, false);
});
test("composable-part brepjs generator implements intersect, trimming a target to just the overlap", () => {
  // "intersect" is the third component operation alongside add/subtract:
  // it trims every targeted "add" component down to just its overlap with
  // the intersect component's own shape, via brepjs's .intersect() -- the
  // classic use case is a D-profile shaft (a round shaft flattened on one
  // side to key into a mating hub), real-kernel-verified elsewhere to match
  // the hand-derived circular-segment volume exactly.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "intersect test",
      components: [
        {
          id: "shaft",
          kind: "boss",
          operation: "add",
          dimensions: { diameter: 10, height: 20 },
        },
        {
          id: "flatCut",
          kind: "box",
          operation: "intersect",
          appliesTo: ["shaft"],
          dimensions: { length: 12, width: 8, height: 22 },
          position: { x: 0, y: 1, z: 0 },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  assert.match(
    result.code,
    /shape\(comp_shaft_\d+\)\.intersect\(intersect_flatCut_\d+\)\.val/,
  );
});
test("composable-part brepjs generator warns instead of silently dropping an intersect component that applies to nothing", () => {
  // Same orphan-appliesTo gap as subtract, on intersect's shared code path.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "orphan intersect test",
      components: [
        {
          id: "trimmer",
          kind: "box",
          operation: "intersect",
          dimensions: { length: 2, width: 2, height: 2 },
        },
        {
          id: "plate",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 4 },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.match(
    result.warnings.join(" "),
    /component trimmer \(intersect\) does not apply to any "add" component; the intersection was not applied/,
  );
  assert.doesNotMatch(result.code, /intersect_trimmer/);
});
test("composable-part brepjs generator applies interleaved subtract/intersect components in declaration order", () => {
  // subtract and intersect share appliesTo/ordering semantics and must
  // interleave according to their actual declaration order (not "every
  // subtract, then every intersect") -- otherwise a component's default
  // appliesTo (every add declared before its own index) and the visible
  // effect of order-sensitive operations could silently disagree with what
  // the spec actually says.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "interleaved subtract/intersect test",
      components: [
        {
          id: "block",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 20 },
        },
        {
          id: "trim",
          kind: "box",
          operation: "intersect",
          appliesTo: ["block"],
          dimensions: { length: 16, width: 16, height: 16 },
        },
        {
          id: "notch",
          kind: "box",
          operation: "subtract",
          appliesTo: ["block"],
          dimensions: { length: 2, width: 2, height: 2 },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  // The intersect must be applied (comp_block_intersect) before the
  // subtract that follows it cuts from that already-trimmed result, not the
  // original comp_block_0.
  const cutLine = result.code
    .split("\n")
    .find((l) => l.includes(".cut(cut_notch"));
  assert.ok(cutLine, "subtract line found");
  assert.match(cutLine, /comp_block_intersect_\d+\)\.cut\(/);
});
test("composable-part brepjs generator implements shell for a box target across all six openFaces", async () => {
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "box shell test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 10 },
        },
      ],
      features: [
        {
          id: "hollow",
          kind: "shell",
          target: "a",
          parameters: {
            thickness: 2,
            openFaces: ["top", "bottom", "front", "back", "left", "right"],
          },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.deepEqual(result.warnings, []);
  assert.match(result.code, /\.shell\(\[/);
  // one atDistance(0, point) selector per requested face, each on the a's own shape
  assert.equal(
    (result.code.match(/faceFinder\(\)\.atDistance\(0, /g) ?? []).length,
    6,
  );
  const executed = await runBrepJsAgainstStub(result.code);
  assert.ok(executed && typeof executed === "object");
});
test("composable-part brepjs generator restricts shell openFaces support by target kind, dropping unsupported faces with a warning", () => {
  // rounded_box's flat side walls are topologically adjacent to its
  // vertical-edge fillets; real-kernel testing found shelling with one of
  // those faces removed silently produces the *original* unshelled volume
  // (no exception, no cavity), so front/back/left/right are excluded for
  // rounded_box even though the exact same faces work fine on a plain box.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "rounded_box shell restriction test",
      components: [
        {
          id: "a",
          kind: "rounded_box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 10, radius: 2 },
        },
      ],
      features: [
        {
          id: "hollow",
          kind: "shell",
          target: "a",
          parameters: { thickness: 1, openFaces: ["top", "front"] },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.match(
    result.warnings.join(" "),
    /does not reliably support openFaces \[front\]; those were dropped from the shell/,
  );
  assert.match(result.code, /\.shell\(\[/);
  assert.equal(
    (result.code.match(/faceFinder\(\)\.atDistance\(0, /g) ?? []).length,
    1,
  );
});
test("composable-part brepjs generator warns and skips shell entirely for a target kind it can't reliably shell", () => {
  // tube's top/bottom faces are annuli that don't cover the local origin
  // the way every other kind's flat cap does, so the atDistance(0, point)
  // face-selection technique can't identify them at all.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "tube shell rejection test",
      components: [
        {
          id: "a",
          kind: "tube",
          operation: "add",
          dimensions: { outerDiameter: 20, innerDiameter: 10, height: 10 },
        },
      ],
      features: [
        {
          id: "hollow",
          kind: "shell",
          target: "a",
          parameters: { thickness: 1, openFaces: ["top"] },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.match(
    result.warnings.join(" "),
    /feature hollow \(shell\) targets component a \(kind "tube"\), which the composable_part brepjs generator does not support shelling for; the shell was not applied/,
  );
  assert.doesNotMatch(result.code, /\.shell\(/);
});
test("composable-part brepjs generator warns and skips shelling a target with multiple pattern instances fused into one shape", () => {
  // brepjs's shell() throws on a compound of disjoint solids (confirmed via
  // real-kernel testing: "Shell operation failed"), so a component with its
  // own pattern -- whose instances are already fused into one shapesById
  // entry by the time features run -- can't be shelled as a single call.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "patterned target shell rejection test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
          pattern: { type: "linear", count: 3, spacing: 20, axis: "x" },
        },
      ],
      features: [
        {
          id: "hollow",
          kind: "shell",
          target: "a",
          parameters: { thickness: 1, openFaces: ["top"] },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.match(
    result.warnings.join(" "),
    /feature hollow \(shell\) targets component a, which has multiple pattern instances fused into a single shape; shelling a multi-instance shape is not supported by the underlying kernel and was skipped/,
  );
  assert.doesNotMatch(result.code, /\.shell\(/);
});
test("composable-part rejects a shell feature whose thickness is too large relative to its target", () => {
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "shell thickness bounds test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 6 },
        },
      ],
      features: [
        {
          id: "hollow",
          kind: "shell",
          target: "a",
          parameters: { thickness: 4, openFaces: ["top"] },
        },
      ],
    },
  };
  assert.match(
    validatePrintSpec(spec).errors.join(" "),
    /feature hollow thickness must be less than half of target a's smallest dimension \(4 >= 3\)/,
  );
});
test("composable-part brepjs generator implements bounded fillet/chamfer across vertical/top/bottom edge selectors", async () => {
  const spec = (edges) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "bounded fillet test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 10 },
        },
      ],
      features: [
        {
          id: "f",
          kind: "fillet",
          target: "a",
          parameters: { radius: 2, edges },
        },
      ],
    },
  });
  for (const edges of ["vertical", "top", "bottom"]) {
    const s = spec(edges);
    assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] }, edges);
    const result = generateBrepJs(s);
    assert.deepEqual(result.warnings, [], edges);
    assert.match(result.code, /\.fillet\(/, edges);
    const executed = await runBrepJsAgainstStub(result.code);
    assert.ok(executed && typeof executed === "object", edges);
  }
  // "vertical" is a self-contained finder-callback expression; "top"/"bottom"
  // additionally emit a face-then-edgesOfFace lookup pair beforehand. (The
  // import line always lists edgesOfFace regardless of use, matching this
  // generator's fixed-import-list style, so check for a call, not just the
  // bare identifier.)
  assert.doesNotMatch(generateBrepJs(spec("vertical")).code, /edgesOfFace\(/);
  assert.match(generateBrepJs(spec("top")).code, /edgesOfFace\(/);
});
test("composable-part brepjs generator implements 'all' edges fillet/chamfer via brepjs's real edgeFinder().findAll()", () => {
  // "all" selects every edge on the target via edgeFinder().findAll(), a
  // full 3D round-over (like a soap bar) -- deliberately restricted to
  // box/plate/tab, not the full vertical/top/bottom set: real-kernel
  // testing confirmed it produces an exact, hand-verifiable Minkowski-sum-
  // style volume for a plain box (core box + edge quarter-cylinders +
  // corner octant-spheres, matching a hand-derived formula exactly), but
  // cylinder/boss have a curved-surface "seam" edge findAll() would also
  // try to fillet with no real-kernel confirmation of the result, and
  // rounded_box already bakes its own vertical-edge fillet into its own
  // construction (stacking risks the same real fillet-after-fillet
  // fragility already documented for fillet+chamfer order-sensitivity).
  const spec = (kind, dimensions, edges = "all") => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "all edges test",
      components: [{ id: "a", kind, operation: "add", dimensions }],
      features: [
        {
          id: "f",
          kind: "fillet",
          target: "a",
          parameters: { radius: 2, edges },
        },
      ],
    },
  });

  const boxSpec = spec("box", { length: 20, width: 20, height: 10 });
  assert.deepEqual(validatePrintSpec(boxSpec), { valid: true, errors: [] });
  const boxResult = generateBrepJs(boxSpec);
  assert.deepEqual(boxResult.warnings, []);
  assert.match(
    boxResult.code,
    /\.fillet\(edgeFinder\(\)\.findAll\(comp_a_\d+\), 2\)/,
  );

  // plate/tab share box's exact construction (centeredBox()), so "all" is
  // supported there too.
  const plateSpec = spec("plate", { length: 20, width: 20, thickness: 10 });
  assert.deepEqual(validatePrintSpec(plateSpec), { valid: true, errors: [] });
  assert.deepEqual(generateBrepJs(plateSpec).warnings, []);

  // Unsupported: cylinder (curved surface, an unconfirmed "seam" edge) and
  // rounded_box (already has its own baked-in vertical-edge fillet) both
  // produce a warning, not a crash or an unverified attempt.
  const cylinderSpec = spec("cylinder", { diameter: 20, height: 10 });
  const cylinderResult = generateBrepJs(cylinderSpec);
  assert.match(
    cylinderResult.warnings.join(" "),
    /does not support edges "all" in the composable_part brepjs generator/,
  );
  const roundedBoxSpec = spec("rounded_box", {
    length: 20,
    width: 20,
    height: 10,
    radius: 2,
  });
  const roundedBoxResult = generateBrepJs(roundedBoxSpec);
  assert.match(
    roundedBoxResult.warnings.join(" "),
    /does not support edges "all"/,
  );

  // A chamfer with "all" works the same way.
  const chamferSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "all edges chamfer test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 10 },
        },
      ],
      features: [
        {
          id: "f",
          kind: "chamfer",
          target: "a",
          parameters: { distance: 2, edges: "all" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(chamferSpec), { valid: true, errors: [] });
  const chamferResult = generateBrepJs(chamferSpec);
  assert.deepEqual(chamferResult.warnings, []);
  assert.match(
    chamferResult.code,
    /\.chamfer\(edgeFinder\(\)\.findAll\(comp_a_\d+\), 2\)/,
  );

  // A patterned target's "all" fillet needs no special per-instance
  // handling (unlike top/bottom) -- edgeFinder().findAll() walks the whole
  // compound directly. Real-kernel-verified elsewhere to match 3x a single
  // instance's own hand-derived all-edges-fillet volume exactly.
  const patternedSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "patterned all edges test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 5 },
          pattern: { type: "linear", axis: "x", count: 3, spacing: 20 },
        },
      ],
      features: [
        {
          id: "f",
          kind: "fillet",
          target: "a",
          parameters: { radius: 2, edges: "all" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(patternedSpec), {
    valid: true,
    errors: [],
  });
  const patternedResult = generateBrepJs(patternedSpec);
  assert.deepEqual(patternedResult.warnings, []);
  assert.match(patternedResult.code, /edgeFinder\(\)\.findAll\(comp_a_\d+\)/);
});
test("composable-part brepjs generator supports newer component kinds as subtract/intersect operands, not just add", () => {
  // Every component kind's operation ("add"/"subtract"/"intersect") is
  // handled by one shared CSG assembly pass with no kind-specific
  // restriction -- but this had never been explicitly exercised for the
  // kinds added this session (torus, ellipsoid, revolved_profile,
  // loft_profile, swept_profile), only ever used as "add". Real-kernel-
  // verified for torus (see examples/composable/orifice-plate-with-oring-groove.json,
  // an O-ring groove cut with a torus subtract, matching a hand-derived
  // volume -- plate minus bore minus exactly half the torus's own volume,
  // since the ring's center sits exactly on the plate's flat top surface --
  // exactly) and swept_profile (a bent channel cut into a solid block,
  // matching a hand-derived volume closely once correctly positioned).
  // Positioning a profile-based kind as a cutter needs the same explicit
  // `position`/`relation` every other kind already needs -- its own
  // points/path are always relative to its own local origin (or, for
  // swept_profile, path[0]), never the target's -- easy to forget, and
  // exactly the mistake made once while developing this test.
  const spec = (groove) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "subtract with newer kinds test",
      components: [
        {
          id: "block",
          kind: "box",
          operation: "add",
          dimensions: { length: 40, width: 40, height: 20 },
        },
        groove,
      ],
    },
  });

  const torusSpec = spec({
    id: "groove",
    kind: "torus",
    operation: "subtract",
    position: { x: 0, y: 0, z: 7 },
    dimensions: { outerDiameter: 30, tubeDiameter: 6 },
  });
  assert.deepEqual(validatePrintSpec(torusSpec), { valid: true, errors: [] });
  const torusResult = generateBrepJs(torusSpec);
  assert.deepEqual(torusResult.warnings, []);
  assert.match(
    torusResult.code,
    /shape\(comp_block_\d+\)\.cut\(cut_groove_\d+\)\.val/,
  );

  const ellipsoidSpec = spec({
    id: "groove",
    kind: "ellipsoid",
    operation: "intersect",
    position: { x: 0, y: 0, z: -5 },
    dimensions: { lengthX: 20, lengthY: 20, lengthZ: 20 },
  });
  assert.deepEqual(validatePrintSpec(ellipsoidSpec), {
    valid: true,
    errors: [],
  });
  const ellipsoidResult = generateBrepJs(ellipsoidSpec);
  assert.deepEqual(ellipsoidResult.warnings, []);
  assert.match(
    ellipsoidResult.code,
    /shape\(comp_block_\d+\)\.intersect\(intersect_groove_\d+\)\.val/,
  );
});
test("composable-part brepjs generator's vertical edge selector accounts for a rotated target's own orientation", () => {
  // Regression guard: a bare 'Z' direction would be wrong for a rotated
  // target (it names world Z, not the target's local Z); real-kernel
  // testing (see brepjs.composable.ts's module doc) confirmed this exact
  // failure mode -- filleting a 30-degree-rotated box's "vertical" edges
  // with the unrotated 'Z' string throws "No edges found for fillet",
  // while the rotated direction vector below succeeds.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "rotated vertical fillet test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 10 },
          rotation: { x: 30, y: 0, z: 0 },
        },
      ],
      features: [
        {
          id: "f",
          kind: "fillet",
          target: "a",
          parameters: { radius: 2, edges: "vertical" },
        },
      ],
    },
  };
  const code = generateBrepJs(spec).code;
  // local Z axis [0,0,1] rotated 30deg extrinsically about X.
  assert.match(
    code,
    /inDirection\(\[0, -0\.49999999999999994, 0\.8660254037844387\]\)/,
  );
});
test("composable-part brepjs generator restricts fillet/chamfer edges support by target kind, warning for unsupported combinations", () => {
  const spec = (kind, dims, edges) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "edges support matrix test",
      components: [{ id: "a", kind, operation: "add", dimensions: dims }],
      features: [
        {
          id: "f",
          kind: "chamfer",
          target: "a",
          parameters: { distance: 1, edges },
        },
      ],
    },
  });
  // cylinder has no straight edges: "vertical" is unsupported.
  const cylinderVertical = spec(
    "cylinder",
    { diameter: 20, height: 10 },
    "vertical",
  );
  assert.match(
    generateBrepJs(cylinderVertical).warnings.join(" "),
    /feature f \(chamfer\) targets component a \(kind "cylinder"\), which does not support edges "vertical".*the chamfer was not applied/,
  );
  assert.doesNotMatch(generateBrepJs(cylinderVertical).code, /\.chamfer\(/);
  // cylinder DOES support top/bottom.
  assert.deepEqual(
    generateBrepJs(spec("cylinder", { diameter: 20, height: 10 }, "top"))
      .warnings,
    [],
  );
  // extruded_profile supports "vertical" (a pure direction filter) but not
  // "top"/"bottom" (the point-based face lookup isn't reliable for a
  // possibly-concave polygon -- same restriction as shell).
  const profileDims = {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    height: 5,
  };
  assert.deepEqual(
    generateBrepJs(spec("extruded_profile", profileDims, "vertical")).warnings,
    [],
  );
  assert.match(
    generateBrepJs(spec("extruded_profile", profileDims, "top")).warnings.join(
      " ",
    ),
    /does not support edges "top"/,
  );
  // tube is unsupported for either selector.
  const tubeDims = { outerDiameter: 20, innerDiameter: 10, height: 10 };
  assert.match(
    generateBrepJs(spec("tube", tubeDims, "top")).warnings.join(" "),
    /does not support edges "top"/,
  );
});
test("composable-part brepjs generator fillets/chamfers a target with multiple pattern instances, replicating the lookup across every instance", async () => {
  // Regression test for a real fix: fillet/chamfer used to reject any
  // patterned target outright (same restriction as shell), even though
  // real-kernel testing found .fillet()/.chamfer() (unlike .shell())
  // tolerate a disjoint-solid compound just fine. "vertical" needs no
  // replication (a pure direction filter matches every qualifying edge
  // across the whole compound automatically); "top"/"bottom" replicates
  // the face lookup across every instance and combines the edges into one
  // array -- confirmed necessary: an unreplicated lookup on a 3-instance
  // compound only ever fillets the one instance a single point-based
  // lookup finds, silently leaving the other two sharp.
  const patternedSpec = (edges) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "patterned target fillet test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
          pattern: { type: "linear", count: 3, spacing: 20, axis: "x" },
        },
      ],
      features: [
        {
          id: "f",
          kind: "fillet",
          target: "a",
          parameters: { radius: 1, edges },
        },
      ],
    },
  });
  for (const edges of ["vertical", "top"]) {
    const s = patternedSpec(edges);
    assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] }, edges);
    const result = generateBrepJs(s);
    assert.deepEqual(result.warnings, [], edges);
    assert.match(result.code, /\.fillet\(/, edges);
    const executed = await runBrepJsAgainstStub(result.code);
    assert.ok(executed && typeof executed === "object", edges);
  }
  // "top"/"bottom" specifically: 3 separate face+edgesOfFace lookups (one
  // per pattern instance, at world x = -20, 0, 20), combined via spread.
  const topCode = generateBrepJs(patternedSpec("top")).code;
  assert.equal(
    (topCode.match(/faceFinder\(\)\.atDistance\(0, /g) ?? []).length,
    3,
  );
  assert.match(topCode, /\[-20, 0, 10\]/);
  assert.match(topCode, /\[0, 0, 10\]/);
  assert.match(topCode, /\[20, 0, 10\]/);
  assert.match(
    topCode,
    /\.fillet\(\[\.\.\.edges_f_\d+, \.\.\.edges_f_\d+, \.\.\.edges_f_\d+\]/,
  );

  // Also works when the pattern comes from a transforming GROUP rather
  // than the component's own `pattern`.
  const groupPatternSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "group-patterned target fillet test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
      ],
      groups: [
        {
          id: "g",
          memberIds: ["a"],
          pattern: { type: "linear", count: 3, spacing: 20, axis: "y" },
        },
      ],
      features: [
        {
          id: "f",
          kind: "fillet",
          target: "a",
          parameters: { radius: 1, edges: "top" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(groupPatternSpec), {
    valid: true,
    errors: [],
  });
  const groupResult = generateBrepJs(groupPatternSpec);
  assert.deepEqual(groupResult.warnings, []);
  assert.equal(
    (groupResult.code.match(/faceFinder\(\)\.atDistance\(0, /g) ?? []).length,
    3,
  );
  const groupExecuted = await runBrepJsAgainstStub(groupResult.code);
  assert.ok(groupExecuted && typeof groupExecuted === "object");
});
test("composable-part brepjs generator still rejects shelling a target with multiple pattern instances (real kernel limitation, unlike fillet/chamfer)", () => {
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "patterned target shell rejection test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
          pattern: { type: "linear", count: 3, spacing: 20, axis: "x" },
        },
      ],
      features: [
        {
          id: "f",
          kind: "shell",
          target: "a",
          parameters: { thickness: 1, openFaces: ["top"] },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  const result = generateBrepJs(spec);
  assert.match(
    result.warnings.join(" "),
    /feature f \(shell\) targets component a, which has multiple pattern instances fused into a single shape; shelling a multi-instance shape is not supported by the underlying kernel and was skipped/,
  );
  assert.doesNotMatch(result.code, /\.shell\(/);
});
test("composable-part rejects a fillet/chamfer feature whose radius\\/distance is too large relative to its target", () => {
  const spec = (kind, param, value) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "fillet/chamfer bounds test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 6 },
        },
      ],
      features: [
        {
          id: "f",
          kind,
          target: "a",
          parameters: { [param]: value, edges: "top" },
        },
      ],
    },
  });
  assert.match(
    validatePrintSpec(spec("fillet", "radius", 4)).errors.join(" "),
    /feature f radius must be less than half of target a's smallest dimension \(4 >= 3\)/,
  );
  assert.match(
    validatePrintSpec(spec("chamfer", "distance", 4)).errors.join(" "),
    /feature f distance must be less than half of target a's smallest dimension \(4 >= 3\)/,
  );
});
test("composable-part brepjs generator implements text embossing and engraving", async () => {
  const spec = (mode) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "text test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 6 },
        },
      ],
      features: [
        {
          id: "t",
          kind: "text",
          target: "a",
          parameters: {
            content: "Hi",
            depth: mode === "engrave" ? 1 : 0.6,
            size: 5,
            fontUrl: "https://example.com/font.ttf",
            mode,
          },
        },
      ],
    },
  });
  for (const mode of ["emboss", "engrave"]) {
    const s = spec(mode);
    assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] }, mode);
    const result = generateBrepJs(s);
    assert.deepEqual(result.warnings, [], mode);
    assert.match(
      result.code,
      /import \{ loadFont, sketchText \} from 'brepjs\/text';/,
      mode,
    );
    assert.match(
      result.code,
      /unwrap\(await loadFont\("https:\/\/example\.com\/font\.ttf", "font_0"\)\);/,
      mode,
    );
    assert.match(
      result.code,
      /sketchText\("Hi", \{ fontSize: 5, fontFamily: "font_0" \}\)\.extrude\(/,
      mode,
    );
    assert.match(
      result.code,
      mode === "emboss"
        ? /\.fuse\(featureCut_t_\d+\)/
        : /\.cut\(featureCut_t_\d+\)/,
      mode,
    );
    const executed = await runBrepJsAgainstStub(result.code);
    assert.ok(executed && typeof executed === "object", mode);
  }
});
test("composable-part brepjs generator dedupes loadFont calls by fontUrl across multiple text features", () => {
  const feature = (id, fontUrl) => ({
    id,
    kind: "text",
    target: "a",
    parameters: { content: "X", depth: 0.5, fontUrl, mode: "emboss" },
  });
  const spec = (features) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "font dedup test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 6 },
        },
      ],
      features,
    },
  });
  const sameUrl = spec([
    feature("t1", "https://example.com/font.ttf"),
    feature("t2", "https://example.com/font.ttf"),
  ]);
  const sameUrlCode = generateBrepJs(sameUrl).code;
  assert.equal((sameUrlCode.match(/loadFont\(/g) ?? []).length, 1);
  assert.match(sameUrlCode, /fontFamily: "font_0"/);
  assert.doesNotMatch(sameUrlCode, /font_1/);

  const twoUrls = spec([
    feature("t1", "https://example.com/font-a.ttf"),
    feature("t2", "https://example.com/font-b.ttf"),
  ]);
  const twoUrlsCode = generateBrepJs(twoUrls).code;
  assert.equal((twoUrlsCode.match(/loadFont\(/g) ?? []).length, 2);
  assert.match(
    twoUrlsCode,
    /loadFont\("https:\/\/example\.com\/font-a\.ttf", "font_0"\)/,
  );
  assert.match(
    twoUrlsCode,
    /loadFont\("https:\/\/example\.com\/font-b\.ttf", "font_1"\)/,
  );
});
test("composable-part brepjs generator only emits the 'brepjs\\/text' import when a spec has a text feature", () => {
  const noText = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "no text test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
        },
      ],
    },
  };
  assert.doesNotMatch(generateBrepJs(noText).code, /brepjs\/text/);
});
test("composable-part rejects a text feature with a malformed or unfetchable-scheme fontUrl", () => {
  // Deliberately doesn't rely on the schema's "format": "uri" for
  // well-formed-URL-ness -- that keyword is a silent no-op in the Python
  // validator (no "uri" FormatChecker registered without the optional
  // rfc3987 package, which this project doesn't depend on), so semantic
  // validation must catch a malformed URL itself, in both languages, the
  // same pre-existing gap supplierReference.url already works around.
  const spec = (fontUrl) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "invalid fontUrl test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 6 },
        },
      ],
      features: [
        {
          id: "t",
          kind: "text",
          target: "a",
          parameters: { content: "Hi", depth: 0.6, fontUrl, mode: "emboss" },
        },
      ],
    },
  });
  // Schema validation (format: "uri", which IS enforced by TS's ajv, unlike
  // Python's jsonschema) rejects "not-a-url" before semantic validation
  // ever runs, so this shows ajv's own message, not textFontUrlErrors()'s
  // -- see the Python-side parity test for the case that exercises this
  // function's own malformed-URL message directly.
  assert.equal(validatePrintSpec(spec("not-a-url")).valid, false);
  // file:// is syntactically valid but real-kernel-verified to never work
  // (Node's fetch() throws on it outright).
  assert.match(
    validatePrintSpec(spec("file:///home/user/fonts/Custom.ttf")).errors.join(
      " ",
    ),
    /feature t \(text\) fontUrl must be an http\(s\):\/\/ URL or a data: URI \(got "file:"\)/,
  );
  // an allowed-but-irrelevant scheme (e.g. ftp:) is rejected the same way.
  assert.match(
    validatePrintSpec(spec("ftp://example.com/font.ttf")).errors.join(" "),
    /feature t \(text\) fontUrl must be an http\(s\):\/\/ URL or a data: URI \(got "ftp:"\)/,
  );
  // http(s):// and data: URIs are both fine.
  assert.deepEqual(validatePrintSpec(spec("https://example.com/font.ttf")), {
    valid: true,
    errors: [],
  });
  assert.deepEqual(validatePrintSpec(spec("data:font/ttf;base64,AAAA")), {
    valid: true,
    errors: [],
  });
});
test("composable-part rejects a text feature whose engrave depth exceeds its target's depth dimension", () => {
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "engrave depth bounds test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 20, width: 20, height: 6 },
        },
      ],
      features: [
        {
          id: "t",
          kind: "text",
          target: "a",
          parameters: {
            content: "Hi",
            depth: 8,
            fontUrl: "https://example.com/font.ttf",
            mode: "engrave",
          },
        },
      ],
    },
  };
  assert.match(
    validatePrintSpec(spec).errors.join(" "),
    /feature t engrave depth must be less than target a height \(8 >= 6\)/,
  );
  // emboss has no depth ceiling -- the same depth is fine in emboss mode.
  const embossVariant = structuredClone(spec);
  embossVariant.part.features[0].parameters.mode = "emboss";
  assert.deepEqual(validatePrintSpec(embossVariant), {
    valid: true,
    errors: [],
  });
});
test("composable-part brepjs generator warns when add components don't form a single connected part", () => {
  // Approximate bounding-box connectivity check: a component positioned
  // with a gap from everything else is a very plausible authoring mistake
  // for a spec composed by hand (or by an agent) without ever rendering
  // the part -- warn instead of silently generating a disconnected shape.
  const box = (id, extra = {}) => ({
    id,
    kind: "box",
    operation: "add",
    dimensions: { length: 10, width: 10, height: 10 },
    ...extra,
  });
  const spec = (components, groups) => {
    const part = {
      type: "composable_part",
      label: "connectivity test",
      components,
    };
    if (groups) part.groups = groups;
    return { printspecVersion: "0.2.0", units: "mm", part };
  };

  const disconnected = spec([
    box("a"),
    box("b", { position: { x: 100, y: 0, z: 0 } }),
  ]);
  assert.deepEqual(validatePrintSpec(disconnected), {
    valid: true,
    errors: [],
  });
  assert.match(
    generateBrepJs(disconnected).warnings.join(" "),
    /components do not appear to form a single connected part.*\[a\] and \[b\]/,
  );

  const touching = spec([
    box("a"),
    box("b", { position: { x: 10, y: 0, z: 0 } }),
  ]);
  assert.doesNotMatch(
    generateBrepJs(touching).warnings.join(" "),
    /single connected part/,
  );

  const overlapping = spec([
    box("a"),
    box("b", { position: { x: 5, y: 0, z: 0 } }),
  ]);
  assert.doesNotMatch(
    generateBrepJs(overlapping).warnings.join(" "),
    /single connected part/,
  );

  // Three components forming two clusters: a+b touch each other, c is far
  // away -- the warning must group a and b together, not flag every pair.
  const twoClusters = spec([
    box("a"),
    box("b", { position: { x: 10, y: 0, z: 0 } }),
    box("c", { position: { x: 200, y: 0, z: 0 } }),
  ]);
  assert.match(
    generateBrepJs(twoClusters).warnings.join(" "),
    /\[a, b\] and \[c\]/,
  );

  // The check accounts for group position, not just each component's own
  // (pre-group) position.
  const groupedFar = spec(
    [box("base"), box("member")],
    [{ id: "g", memberIds: ["member"], position: { x: 500, y: 0, z: 0 } }],
  );
  assert.match(
    generateBrepJs(groupedFar).warnings.join(" "),
    /single connected part/,
  );
  const groupedTouching = structuredClone(groupedFar);
  groupedTouching.part.groups[0].position.x = 10;
  assert.doesNotMatch(
    generateBrepJs(groupedTouching).warnings.join(" "),
    /single connected part/,
  );
});
test("composable-part connectivity check catches a gap hidden inside a component's own pattern spread", () => {
  // Regression test for a real bug: patternOffsets()'s per-instance formula
  // is always symmetric about its anchor, so a *combined envelope* spanning
  // every instance of a component's own pattern always reaches back through
  // that anchor point regardless of how far apart the actual instances are
  // -- if the anchor happens to sit on another component (as on_top_of
  // naturally does here), the envelope wrongly "touches" it even when no
  // actual instance is anywhere close. The check must compare every
  // instance of one component against every instance of another, not their
  // combined envelopes.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "own-pattern connectivity test",
      components: [
        {
          id: "plate",
          kind: "plate",
          operation: "add",
          dimensions: { length: 20, width: 20, thickness: 4 },
        },
        {
          id: "boss",
          kind: "boss",
          operation: "add",
          dimensions: { diameter: 6, height: 6 },
          relation: { type: "on_top_of", target: "plate" },
          pattern: { type: "linear", count: 2, spacing: 400, axis: "x" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  assert.match(
    generateBrepJs(spec).warnings.join(" "),
    /single connected part.*\[boss\] and \[plate\]/,
  );
  // A tightly-spaced pattern (instances genuinely resting on the plate) must
  // not be flagged.
  const tight = structuredClone(spec);
  tight.part.components[1].pattern.spacing = 8;
  assert.doesNotMatch(
    generateBrepJs(tight).warnings.join(" "),
    /single connected part/,
  );
});
test("composable-part rejects an inverted tube (innerDiameter >= outerDiameter)", () => {
  // Regression test: an inverted tube previously validated cleanly but
  // real-kernel testing confirmed it produces a zero-volume, degenerate
  // solid ("shape has no geometry") with no warning at all -- the
  // documented "innerDiameter must be less than outerDiameter" constraint
  // was never actually checked for composable_part.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "inverted tube test",
      components: [
        {
          id: "badTube",
          kind: "tube",
          operation: "add",
          dimensions: { outerDiameter: 10, innerDiameter: 20, height: 10 },
        },
      ],
    },
  };
  assert.match(
    validatePrintSpec(spec).errors.join(" "),
    /component badTube \(tube\) innerDiameter must be less than outerDiameter \(20 >= 10\)/,
  );
  const equalDiameters = structuredClone(spec);
  equalDiameters.part.components[0].dimensions.innerDiameter = 10;
  assert.match(
    validatePrintSpec(equalDiameters).errors.join(" "),
    /innerDiameter must be less than outerDiameter/,
  );
  const valid = structuredClone(spec);
  valid.part.components[0].dimensions.innerDiameter = 6;
  assert.deepEqual(validatePrintSpec(valid), { valid: true, errors: [] });
});
test("composable-part warns when a stacked feature targets a patterned feature but has no pattern of its own", () => {
  // A component's or feature's own pattern doesn't propagate through a
  // stacked feature -- a counterbore stacked on a patterned hole with no
  // matching pattern of its own silently applies only once, at the hole
  // pattern's center, leaving every other instance a plain (uncounterbored)
  // hole. Valid and sometimes intentional, but easy to author by accident
  // with no other signal -- warn instead of staying silent.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "stacked feature on patterned target test",
      components: [
        {
          id: "plate",
          kind: "plate",
          operation: "add",
          dimensions: { length: 60, width: 20, thickness: 8 },
        },
      ],
      features: [
        {
          id: "hole",
          kind: "hole",
          target: "plate",
          relation: { type: "attached_to_face", target: "plate", face: "top" },
          pattern: { type: "linear", count: 3, spacing: 15, axis: "x" },
          parameters: { diameter: 4, depth: "through" },
        },
        {
          id: "cb",
          kind: "counterbore",
          target: "hole",
          parameters: { diameter: 8, depth: 3 },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(spec), { valid: true, errors: [] });
  assert.match(
    generateBrepJs(spec).warnings.join(" "),
    /feature cb targets hole, which has its own pattern, but cb has no pattern of its own/,
  );
  // Giving the stacked feature the same pattern silences the warning.
  const fixed = structuredClone(spec);
  fixed.part.features[1].pattern = {
    type: "linear",
    count: 3,
    spacing: 15,
    axis: "x",
  };
  assert.doesNotMatch(
    generateBrepJs(fixed).warnings.join(" "),
    /has no pattern of its own/,
  );
  // Targeting a member of a patterned *group* already auto-propagates
  // correctly (see docs/composable-parts.md, "Patterns") and must not
  // trigger this warning even with no pattern of its own.
  const groupTargeted = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "feature on patterned group member",
      components: [
        {
          id: "plate",
          kind: "plate",
          operation: "add",
          dimensions: { length: 60, width: 60, thickness: 8 },
        },
        {
          id: "standoff",
          kind: "boss",
          operation: "add",
          dimensions: { diameter: 8, height: 6 },
        },
      ],
      groups: [
        {
          id: "cluster",
          memberIds: ["standoff"],
          pattern: {
            type: "rectangular",
            countX: 2,
            countY: 2,
            spacingX: 40,
            spacingY: 40,
          },
        },
      ],
      features: [
        {
          id: "standoffHole",
          kind: "hole",
          target: "standoff",
          parameters: { diameter: 3, depth: "through" },
        },
      ],
    },
  };
  assert.deepEqual(validatePrintSpec(groupTargeted), {
    valid: true,
    errors: [],
  });
  assert.doesNotMatch(
    generateBrepJs(groupTargeted).warnings.join(" "),
    /has no pattern of its own/,
  );
});
test("composable-part relation.targetInstance anchors to one specific pattern instance", () => {
  // relation.targetInstance is the addressed alternative to the "no pattern
  // of its own" warning above: a stacked feature (or any relation) can opt
  // into anchoring to exactly one instance of a patterned target instead of
  // its pattern center, without needing its own matching pattern.
  // Real-kernel-verified elsewhere (examples/composable/corner-counterbore-
  // with-target-instance.json) to match the hand-derived volume exactly.
  const spec = (targetInstance) => ({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "targetInstance test",
      components: [
        {
          id: "plate",
          kind: "plate",
          operation: "add",
          dimensions: { length: 60, width: 20, thickness: 8 },
        },
      ],
      features: [
        {
          id: "hole",
          kind: "hole",
          target: "plate",
          relation: { type: "attached_to_face", target: "plate", face: "top" },
          pattern: { type: "linear", count: 3, spacing: 15, axis: "x" },
          parameters: { diameter: 4, depth: "through" },
        },
        {
          id: "cb",
          kind: "counterbore",
          target: "hole",
          relation: { type: "offset_from", target: "hole", targetInstance },
          parameters: { diameter: 8, depth: 3 },
        },
      ],
    },
  });
  const targeted = spec(2);
  assert.deepEqual(validatePrintSpec(targeted), { valid: true, errors: [] });
  const result = generateBrepJs(targeted);
  // Must NOT trigger the "no pattern of its own" warning -- this is the
  // deliberate, addressed version of that same choice.
  assert.doesNotMatch(result.warnings.join(" "), /has no pattern of its own/);
  // Instance 2 of a 3-count linear pattern (spacing 15, centered) is at
  // x=15, not the pattern's center (x=0).
  assert.match(
    result.code,
    /featureCut_cb_\d+ = .*translate\(\[15, 0, 8\]\)\.val/,
  );

  // Out of bounds.
  assert.match(
    validatePrintSpec(spec(5)).errors.join(" "),
    /feature cb relation targetInstance 5 is out of bounds for hole's pattern \(3 instance\(s\)\)/,
  );

  // targetInstance on an unpatterned target is rejected.
  const unpatterned = spec(0);
  unpatterned.part.features[1].relation.target = "plate";
  assert.match(
    validatePrintSpec(unpatterned).errors.join(" "),
    /feature cb relation targetInstance is only valid when target is patterned: plate/,
  );

  // targetInstance on a patterned *group* target is rejected (a different,
  // unhandled anchor-resolution shape -- see docs/composable-parts.md).
  const groupTarget = spec(0);
  groupTarget.part.groups = [
    {
      id: "grp",
      memberIds: ["plate"],
      pattern: { type: "linear", count: 2, spacing: 40, axis: "x" },
    },
  ];
  groupTarget.part.features[1].relation.target = "grp";
  assert.match(
    validatePrintSpec(groupTarget).errors.join(" "),
    /feature cb relation targetInstance is not supported for a group target: grp/,
  );
});
test("composable-part relations reject ambiguous targets and group transform conflicts", () => {
  const box = (id, extra = {}) => ({
    id,
    kind: "box",
    operation: "add",
    dimensions: { length: 10, width: 10, height: 10 },
    ...extra,
  });
  const spec = (components, groups) => {
    const part = {
      type: "composable_part",
      label: "ambiguity test",
      components,
    };
    if (groups) part.groups = groups;
    return { printspecVersion: "0.2.0", units: "mm", part };
  };
  const rectPattern = {
    type: "rectangular",
    countX: 2,
    countY: 2,
    spacingX: 20,
    spacingY: 20,
  };

  // A relation may not anchor to a patterned component (no single instance
  // to anchor to), but CSG (appliesTo) against a patterned target is fine.
  const targetsPattern = spec([
    box("a", { pattern: rectPattern }),
    box("b", { relation: { type: "on_top_of", target: "a" } }),
  ]);
  assert.match(
    validatePrintSpec(targetsPattern).errors.join(" "),
    /relation target is a patterned component\/feature and cannot be used as a positional anchor: a/,
  );
  const cutsPattern = spec([
    box("a", { pattern: rectPattern }),
    box("cut", {
      operation: "subtract",
      appliesTo: ["a"],
      dimensions: { length: 2, width: 2, height: 2 },
    }),
  ]);
  assert.deepEqual(validatePrintSpec(cutsPattern), { valid: true, errors: [] });

  // A group's relation may not target its own member.
  const groupTargetsOwnMember = spec(
    [box("a"), box("b")],
    [
      {
        id: "grp",
        memberIds: ["a"],
        relation: { type: "on_top_of", target: "a" },
      },
    ],
  );
  assert.match(
    validatePrintSpec(groupTargetsOwnMember).errors.join(" "),
    /group grp relation target is one of its own members: a/,
  );
  const groupTargetsOther = spec(
    [box("a"), box("b")],
    [
      {
        id: "grp",
        memberIds: ["a"],
        relation: { type: "on_top_of", target: "b" },
      },
    ],
  );
  assert.deepEqual(validatePrintSpec(groupTargetsOther), {
    valid: true,
    errors: [],
  });

  // A component may not belong to more than one group that itself has a
  // position/rotation/relation, since it would be ambiguous which (or how
  // many) transforms apply; purely organizational (transform-free) groups
  // don't count.
  const twoTransformingGroups = spec(
    [box("a"), box("b")],
    [
      { id: "g1", memberIds: ["a"], position: { x: 1, y: 0, z: 0 } },
      { id: "g2", memberIds: ["a"], position: { x: 2, y: 0, z: 0 } },
    ],
  );
  assert.match(
    validatePrintSpec(twoTransformingGroups).errors.join(" "),
    /component a is a member of more than one group with its own position\/rotation\/relation\/pattern: g1, g2/,
  );
  const oneTransformingOneTag = spec(
    [box("a"), box("b")],
    [
      { id: "g1", memberIds: ["a"], position: { x: 1, y: 0, z: 0 } },
      { id: "g2", memberIds: ["a"] },
    ],
  );
  assert.deepEqual(validatePrintSpec(oneTransformingOneTag), {
    valid: true,
    errors: [],
  });

  // A grouped component's world position depends on its transforming
  // group's own resolved transform (see worldPosition() in
  // brepjs.composable.ts), which is itself a dependency edge -- so a cycle
  // that only closes through that implicit edge (not through any single
  // node's own `relation`) must still be caught, not infinite-loop.
  const cycleViaGroupMembership = spec(
    [box("a"), box("b", { relation: { type: "on_top_of", target: "a" } })],
    [
      {
        id: "g",
        memberIds: ["a"],
        position: { x: 1, y: 0, z: 0 },
        relation: { type: "on_top_of", target: "b" },
      },
    ],
  );
  assert.match(
    validatePrintSpec(cycleViaGroupMembership).errors.join(" "),
    /relation cycle detected: b -> a -> g -> b/,
  );
});
test("cornerRadius/chamfer/fillet produce a not-implemented warning everywhere except where implemented", () => {
  const families = [
    ["spacer-block.four-hole.json", "spacer-block.schema.json"],
    ["round-spacer.basic.json", "round-spacer.schema.json"],
    ["electronics-standoff.m3.json", "electronics-standoff.schema.json"],
    ["cable-comb.usb.json", "cable-comb.schema.json"],
    ["cable-clip.basic.json", "cable-clip.schema.json"],
    ["wall-mount-bracket.basic.json", "wall-mount-bracket.schema.json"],
    ["l-bracket.basic.json", "l-bracket.schema.json"],
    ["project-enclosure-tray.basic.json", "project-enclosure-tray.schema.json"],
    [
      "rounded-rectangular-plate.basic.json",
      "rounded-rectangular-plate.schema.json",
    ],
  ];
  // The OpenSCAD generator builds a whole-part chamfer for these families, so
  // it no longer warns for a (targetless) chamfer on them; CadQuery and the
  // family BRepJS generator still do.
  const openscadChamferFamilies = new Set([
    "spacer_block",
    "round_spacer",
    "rounded_rectangular_plate",
  ]);
  for (const [file, schemaFile] of families) {
    const props = read("schemas/" + schemaFile).properties.parameters
      .properties;
    const s = read("examples/part-families/" + file);
    const partType = s.part.type;
    const expectChamferWarning = "chamfer" in props;
    // Only rounded_rectangular_plate actually implements cornerRadius.
    const expectCornerRadiusWarning =
      file !== "rounded-rectangular-plate.basic.json";
    if (expectChamferWarning) s.part.parameters.chamfer = { distance: 0.5 };
    s.part.parameters.cornerRadius = 1;
    for (const generate of [
      generateOpenScad,
      generateCadQuery,
      generateBrepJs,
    ]) {
      const w = generate(s).warnings.join(" ");
      const chamferBuilt =
        generate === generateOpenScad && openscadChamferFamilies.has(partType);
      if (expectChamferWarning && !chamferBuilt)
        assert.match(
          w,
          /chamfer requested but not implemented/,
          `${file} chamfer`,
        );
      if (chamferBuilt)
        assert.doesNotMatch(
          w,
          /chamfer requested but not implemented/,
          `${file} chamfer built`,
        );
      if (expectCornerRadiusWarning)
        assert.match(
          w,
          /cornerRadius requested but not implemented/,
          `${file} cornerRadius`,
        );
      else
        assert.doesNotMatch(
          w,
          /cornerRadius requested but not implemented/,
          file,
        );
    }
  }
});
test("validatePrintSpec narrows a recognized part.type to just its own schema instead of every failed oneOf branch", () => {
  // part.type is a valid composable_part discriminator, but this component's
  // position is missing y/z (both required on Point3D). Before narrowing,
  // ajv's oneOf over part-family.schema.json (13 types) + composable-
  // part.schema.json reported a failure for every one of those 14 branches
  // (dozens of irrelevant "doesn't match spacer_block"/etc. errors) on top
  // of the two real ones; narrowing by part.type should report only the
  // two real errors from composable-part.schema.json itself.
  const spec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "narrowing test",
      components: [
        {
          id: "a",
          kind: "box",
          operation: "add",
          dimensions: { length: 10, width: 10, height: 10 },
          position: { x: 1 },
        },
      ],
    },
  };
  const result = validatePrintSpec(spec);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2, result.errors.join("; "));
  for (const e of result.errors)
    assert.match(e, /position: must have required property/);
  // Same narrowing directly against validateComposablePartSpec (unaffected
  // by this change, since it never went through the part-level oneOf) for
  // parity confirmation -- paths differ only by the "/part" prefix, since
  // that call validates spec.part directly rather than the whole spec.
  const partOnlyResult = validateComposablePartSpec(spec.part);
  assert.deepEqual(
    result.errors.map((e) => e.replace(/^\/part/, "")),
    partOnlyResult.errors,
  );
});
test("validatePrintSpec and validatePartFamilySpec narrow a recognized family part.type the same way", () => {
  // round_spacer's innerDiameter must be less than outerDiameter, but that's
  // a *semantic* check (unaffected here); this is a schema-level mistake
  // (missing required "height") that should only ever produce round_spacer-
  // specific errors, not a failure for every other family branch too.
  const badPart = {
    type: "round_spacer",
    label: "narrowing test",
    parameters: { outerDiameter: 10, innerDiameter: 4 },
  };
  const familyResult = validatePartFamilySpec(badPart);
  assert.equal(familyResult.valid, false);
  assert.ok(
    familyResult.errors.every((e) => /height/.test(e)),
    familyResult.errors.join("; "),
  );
  const printSpecResult = validatePrintSpec({
    printspecVersion: "0.2.0",
    units: "mm",
    part: badPart,
  });
  assert.equal(printSpecResult.valid, false);
  assert.deepEqual(
    printSpecResult.errors.map((e) => e.replace(/^\/part/, "")),
    familyResult.errors,
  );
});
test("typescript cli commands", () => {
  const cli = path.join(root, "packages/typescript/dist/cli.js");
  for (const args of [
    ["validate", "examples/part-families/rounded-rectangular-plate.basic.json"],
    ["to-openscad", "examples/part-families/round-spacer.basic.json"],
    ["to-cadquery", "examples/part-families/electronics-standoff.m3.json"],
    ["to-brepjs", "examples/part-families/spacer-block.four-hole.json"],
    [
      "bom",
      "examples/projects/simple-enclosure-project.json",
      "--format",
      "markdown",
    ],
  ]) {
    const r = spawnSync("node", [cli, ...args], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `${args.join(" ")} ${r.stderr}`);
    assert.ok((r.stdout + r.stderr).length > 0);
  }
  const bad = spawnSync(
    "node",
    [
      cli,
      "validate",
      "tests/fixtures/invalid/round-spacer-inner-too-large.json",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /invalid/);
  const malformed = path.join(root, "tests/fixtures/invalid-json.tmp.json");
  fs.writeFileSync(malformed, "{bad json");
  try {
    const r = spawnSync("node", [cli, "validate", malformed], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /invalid-json\.tmp\.json/);
    assert.match(r.stderr, /parse error/);
  } finally {
    fs.rmSync(malformed, { force: true });
  }
});

test("typescript cli version commands", () => {
  const cli = path.join(root, "packages/typescript/dist/cli.js");
  for (const args of [["--version"], ["version"]]) {
    const r = spawnSync("node", [cli, ...args], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      new RegExp(
        `printspec ${read("packages/typescript/package.json").version.replaceAll(".", "\\.")}`,
      ),
    );
  }
});

test("typescript cli friendly user errors", () => {
  const cli = path.join(root, "packages/typescript/dist/cli.js");
  const help = spawnSync("node", [cli, "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /usage: printspec/);
  const badCommand = spawnSync("node", [cli, "wat"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(badCommand.status, 1);
  assert.match(badCommand.stderr, /unknown command wat/);
  assert.doesNotMatch(badCommand.stderr, /Error:|\n\s+at /);
  const missing = spawnSync("node", [cli, "validate", "does-not-exist.json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /does-not-exist\.json/);
  assert.match(missing.stderr, /read error/);
  assert.doesNotMatch(missing.stderr, /Error:|\n\s+at /);
  const malformed = path.join(root, "tests/fixtures/invalid-json.tmp.json");
  fs.writeFileSync(malformed, "{bad json");
  try {
    const r = spawnSync("node", [cli, "validate", malformed], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /invalid-json\.tmp\.json/);
    assert.match(r.stderr, /parse error/);
    assert.doesNotMatch(r.stderr, /Error:|\n\s+at /);
  } finally {
    fs.rmSync(malformed, { force: true });
  }
});

test("form metadata helpers and cli expose schema UI metadata", async () => {
  const { getPartFamilyFormMetadata, listPartFamilies } =
    await import("../../packages/typescript/dist/index.js");
  const families = listPartFamilies();
  const schemaFiles = fs
    .readdirSync(path.join(root, "schemas"))
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => read("schemas/" + f))
    .filter((s) => s.properties?.type?.const && s.properties?.parameters);
  assert.equal(families.length, schemaFiles.length);
  assert.ok(
    families.some(
      (f) => f.type === "rounded_rectangular_plate" && f.generatorSupported,
    ),
  );
  const rr = getPartFamilyFormMetadata("rounded_rectangular_plate");
  assert.deepEqual(
    rr.fields.slice(0, 4).map((f) => f.name),
    ["length", "width", "thickness", "cornerRadius"],
  );
  assert.equal(rr.fields[0].unit, "mm");
  assert.equal(rr.fields[0].control, "number");
  assert.throws(() => getPartFamilyFormMetadata("unknown_part"), /Unsupported/);
  const cli = path.join(root, "packages/typescript/dist/cli.js");
  const meta = spawnSync("node", [cli, "form-metadata", "spacer_block"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(meta.status, 0, meta.stderr);
  assert.equal(JSON.parse(meta.stdout).partType, "spacer_block");
  const list = spawnSync("node", [cli, "list-part-families"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(list.status, 0, list.stderr);
  assert.ok(JSON.parse(list.stdout).some((f) => f.type === "spacer_block"));
  const bad = spawnSync("node", [cli, "form-metadata", "missing"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(bad.status, 1);
});

test("schema UI metadata quality", () => {
  const rich = new Set([
    "rounded_rectangular_plate",
    "spacer_block",
    "round_spacer",
    "electronics_standoff",
    "simple_box",
    "simple_lid",
  ]);
  for (const file of fs
    .readdirSync(path.join(root, "schemas"))
    .filter((f) => f.endsWith(".schema.json"))) {
    const schema = read("schemas/" + file);
    const partType = schema.properties?.type?.const;
    if (!partType || !schema.properties?.parameters) continue;
    assert.ok(schema.title, file);
    assert.ok(schema.description, file);
    const params = schema.properties.parameters;
    assert.ok(params.title, file);
    assert.ok(params.description, file);
    const props = params.properties;
    const names = new Set(Object.keys(props));
    const ui = params["x-printspec-ui"];
    assert.ok(ui?.order, file);
    for (const name of ui.order)
      assert.ok(names.has(name), `${file} order ${name}`);
    for (const group of ui.groups ?? [])
      for (const name of group.fields)
        assert.ok(names.has(name), `${file} group ${name}`);
    for (const req of params.required ?? [])
      assert.ok(
        ui.order.includes(req) ||
          (ui.groups ?? []).some((g) => g.fields.includes(req)),
        `${file} required ${req}`,
      );
    if (rich.has(partType)) {
      for (const [name, field] of Object.entries(props)) {
        assert.ok(field.title, `${file} ${name} title`);
        assert.ok(field.description, `${file} ${name} description`);
        assert.ok(field["x-printspec-control"], `${file} ${name} control`);
        if (field.type === "number")
          assert.ok(field["x-printspec-unit"], `${file} ${name} unit`);
      }
    }
  }
});

test("bundle helpers create deterministic files and refuse traversal", async () => {
  const { createBundle, writeBundleToDirectory } =
    await import("../../packages/typescript/dist/index.js");
  const b = createBundle(spec, { includePartCad: true });
  assert.equal(b.supported, true);
  const paths = b.files.map((f) => f.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.ok(paths.includes("printspec.json"));
  assert.ok(paths.includes("cad/model.scad"));
  assert.ok(paths.includes("cad/model.py"));
  assert.ok(
    !paths.includes("cad/model.brep.ts"),
    "brepjs source is opt-in, not included by default",
  );
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("bundle-manifest.json"));
  const withBrepJs = createBundle(spec, { includeBrepJs: true });
  assert.ok(withBrepJs.files.some((f) => f.path === "cad/model.brep.ts"));
  assert.equal(
    JSON.parse(b.files.find((f) => f.path === "bundle-manifest.json").content)
      .kind,
    "part",
  );
  assert.match(
    b.files.find((f) => f.path === "README.md").content,
    /Generated CAD source should be reviewed/,
  );
  assert.throws(
    () =>
      writeBundleToDirectory(
        {
          supported: true,
          files: [{ path: "../evil", content: "x", mediaType: "text/plain" }],
          warnings: [],
        },
        "/tmp/printspec-bad",
        { overwrite: true },
      ),
    /Unsafe/,
  );
});

test("bundle project and typescript cli write expected files", async () => {
  const { createBundle } =
    await import("../../packages/typescript/dist/index.js");
  const b = createBundle(project, { includePartCad: true });
  const paths = b.files.map((f) => f.path);
  assert.ok(paths.includes("bom/bom.md"));
  assert.ok(paths.includes("partcad.yaml"));
  assert.ok(paths.includes("parts/base/printspec.json"));
  assert.ok(b.warnings.length >= 2);
  const cli = path.join(root, "packages/typescript/dist/cli.js");
  const out = path.join(root, "tests/fixtures/tmp-ts-bundle");
  fs.rmSync(out, { recursive: true, force: true });
  try {
    const r = spawnSync(
      "node",
      [
        cli,
        "bundle",
        "examples/part-families/rounded-rectangular-plate.basic.json",
        "--output",
        out,
        "--overwrite",
        "--brepjs",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(out, "bundle-manifest.json")));
    assert.ok(fs.existsSync(path.join(out, "cad/model.py")));
    assert.ok(fs.existsSync(path.join(out, "cad/model.brep.ts")));
    assert.match(r.stdout, /wrote \d+ files/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("all ten core 0.2.0 family examples validate and generate outputs", async () => {
  const { createBundle } =
    await import("../../packages/typescript/dist/index.js");
  const { generatePreviewScene } =
    await import("../../packages/typescript/dist/preview/index.js");
  const files = [
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
  ];
  const seen = new Set();
  for (const file of files) {
    const s = read("examples/part-families/" + file);
    const type = s.part.type;
    seen.add(type);
    assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] }, type);
    const scad = generateOpenScad(s);
    assert.equal(scad.supported, true, type);
    assert.match(
      scad.code,
      new RegExp(
        type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "|difference|cylinder|cube",
      ),
      type,
    );
    assert.doesNotMatch(
      scad.code,
      /^(?:\/\/.*\n)+[^/\n]/,
      `${type} separates top comments from generated parameters or geometry`,
    );
    const cq = generateCadQuery(s);
    assert.equal(cq.supported, true, type);
    assert.match(cq.code, /part\s*=/, type);
    assert.doesNotMatch(
      cq.code,
      /\.rounded_rect\(|\.roundedRect\(|\.rounded_rectangle\(|\.roundedRectangle\(/,
      type,
    );
    assert.doesNotMatch(cq.code, /\.(?:slot|roundedBox|roundedCube)\(/, type);
    const brep = generateBrepJs(s);
    assert.equal(brep.supported, true, type);
    assert.match(brep.code, /export default \(\) => part;/, type);
    const preview = generatePreviewScene(s);
    assert.equal(preview.supported, true, type);
    assert.ok(
      preview.scene.objects.some((o) => o.material === "body"),
      type,
    );
    const bundle = createBundle(s);
    assert.equal(bundle.supported, true, type);
    for (const required of [
      "printspec.json",
      "cad/model.scad",
      "cad/model.py",
      "README.md",
      "bundle-manifest.json",
    ])
      assert.ok(
        bundle.files.some(
          (f) => f.path === required && f.content && f.mediaType,
        ),
        `${type} ${required}`,
      );
  }
  assert.equal(seen.size, 10);
});

test("generatorSupported metadata matches actual generator support for every family", async () => {
  const { listPartFamilies } =
    await import("../../packages/typescript/dist/index.js");
  const byType = new Map();
  for (const f of fs
    .readdirSync(path.join(root, "examples/part-families"))
    .filter((f) => f.endsWith(".json"))) {
    const s = read("examples/part-families/" + f);
    if (s.part) byType.set(s.part.type, s);
  }
  const families = listPartFamilies();
  assert.ok(families.length > 0);
  for (const family of families) {
    const example = byType.get(family.type);
    assert.ok(example, `no example fixture for family ${family.type}`);
    const scadSupported = generateOpenScad(example).supported;
    const cqSupported = generateCadQuery(example).supported;
    const brepSupported = generateBrepJs(example).supported;
    assert.equal(
      scadSupported,
      cqSupported,
      `${family.type}: openscad/cadquery support disagree`,
    );
    assert.equal(
      scadSupported,
      brepSupported,
      `${family.type}: openscad/brepjs support disagree`,
    );
    assert.equal(
      family.generatorSupported,
      scadSupported,
      `${family.type}: generatorSupported metadata (${family.generatorSupported}) does not match actual generator support (${scadSupported})`,
    );
  }
});
