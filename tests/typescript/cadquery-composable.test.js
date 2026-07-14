// Tests for the composable_part CadQuery generator
// (packages/typescript/src/generators/cadquery.composable.ts). This suite
// checks generated *code shape* only (schema validation + string/regex
// assertions), matching the existing part-family CadQuery tests in
// printspec.test.js -- it deliberately does not execute the generated
// Python (that needs a real `cadquery` install, which `npm test`/CI can't
// assume). Real-kernel verification -- volume/validity checks against an
// actual installed `cadquery`, including exact cross-generator agreement
// with brepjs's own already-verified example volumes -- was done by hand
// via scripts/cadquery-verify/verify.mjs while developing this generator;
// see docs/generators.md for the results.
import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePrintSpec,
  generateCadQuery,
} from "../../packages/typescript/dist/index.js";

function spec(components, features, groups, constraints) {
  return {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "composable_part",
      label: "cadquery composable test",
      components,
      ...(features ? { features } : {}),
      ...(groups ? { groups } : {}),
      ...(constraints ? { constraints } : {}),
    },
  };
}

test("composable-part cadquery generator emits a plain Python module for a simple box", () => {
  const s = spec([
    {
      id: "a",
      kind: "box",
      operation: "add",
      dimensions: { length: 20, width: 20, height: 10 },
    },
  ]);
  assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] });
  const r = generateCadQuery(s);
  assert.equal(r.supported, true);
  assert.deepEqual(r.warnings, []);
  assert.match(r.code, /^import cadquery as cq/m);
  assert.match(
    r.code,
    /comp_a_\d+ = cq\.Solid\.makeBox\(20, 20, 10\)\.translate\(\(-10, -10, 0\)\)/,
  );
  assert.match(r.code, /^part = part_0$/m);
  assert.doesNotMatch(r.code, /require\(|subprocess|os\.system|eval\(/);
});

test("composable-part cadquery generator implements every box-like component kind", () => {
  const kinds = {
    rounded_box: { length: 20, width: 20, height: 10, radius: 3 },
    cylinder: { diameter: 10, height: 10 },
    tube: { outerDiameter: 10, innerDiameter: 5, height: 10 },
    plate: { length: 20, width: 10, thickness: 4 },
    tab: { length: 20, width: 10, thickness: 4 },
    boss: { diameter: 8, height: 10 },
    sphere: { diameter: 10 },
    torus: { outerDiameter: 20, tubeDiameter: 4 },
    ellipsoid: { lengthX: 10, lengthY: 8, lengthZ: 6 },
  };
  for (const [kind, dimensions] of Object.entries(kinds)) {
    const s = spec([{ id: "a", kind, operation: "add", dimensions }]);
    assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] }, kind);
    const r = generateCadQuery(s);
    assert.equal(r.supported, true, kind);
    assert.deepEqual(r.warnings, [], kind);
  }
});

test("composable-part cadquery generator builds sphere as a FULL sphere, not the makeSphere() default hemisphere", () => {
  // Real-kernel testing found cq.Solid.makeSphere(radius) alone defaults to
  // a hemisphere (angleDegrees1=0, angleDegrees2=90); angleDegrees1=-90 is
  // required for a full sphere. Regression guard for that finding.
  const s = spec([
    { id: "a", kind: "sphere", operation: "add", dimensions: { diameter: 10 } },
  ]);
  const r = generateCadQuery(s);
  assert.match(r.code, /makeSphere\(5, angleDegrees1=-90, angleDegrees2=90\)/);
});

test("composable-part cadquery generator supports rib, wedge, and extruded_profile with curves", () => {
  const ribSpec = spec([
    {
      id: "a",
      kind: "rib",
      operation: "add",
      dimensions: { length: 20, thickness: 4, height: 10 },
    },
  ]);
  assert.deepEqual(validatePrintSpec(ribSpec), { valid: true, errors: [] });
  const ribResult = generateCadQuery(ribSpec);
  assert.equal(ribResult.supported, true);
  assert.match(
    ribResult.code,
    /cq\.Solid\.extrudeLinear\(cq\.Wire\.assembleEdges/,
  );

  const wedgeSpec = spec([
    {
      id: "a",
      kind: "wedge",
      operation: "add",
      dimensions: { length: 20, width: 4, height: 10 },
    },
  ]);
  assert.equal(generateCadQuery(wedgeSpec).supported, true);

  const profileSpec = spec([
    {
      id: "bulged",
      kind: "extruded_profile",
      operation: "add",
      dimensions: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10, curve: { type: "arc", through: { x: 5, y: 15 } } },
          {
            x: 0,
            y: 10,
            curve: { type: "spline", through: [{ x: -3, y: 5 }] },
          },
        ],
        height: 5,
      },
    },
  ]);
  assert.deepEqual(validatePrintSpec(profileSpec), { valid: true, errors: [] });
  const profileResult = generateCadQuery(profileSpec);
  assert.equal(profileResult.supported, true);
  assert.match(profileResult.code, /cq\.Edge\.makeThreePointArc\(/);
  assert.match(profileResult.code, /cq\.Edge\.makeSplineApprox\(\[cq\.Vector/);
});

test("composable-part cadquery generator supports revolved_profile, loft_profile, and swept_profile", () => {
  const revolveSpec = spec([
    {
      id: "hub",
      kind: "revolved_profile",
      operation: "add",
      dimensions: {
        points: [
          {
            radius: 5,
            z: 0,
            curve: { type: "bezier", controlPoints: [{ radius: 8, z: 5 }] },
          },
          { radius: 10, z: 10 },
          { radius: 0, z: 10 },
          { radius: 0, z: 0 },
        ],
      },
    },
  ]);
  assert.deepEqual(validatePrintSpec(revolveSpec), { valid: true, errors: [] });
  const revolveResult = generateCadQuery(revolveSpec);
  assert.equal(revolveResult.supported, true);
  assert.match(
    revolveResult.code,
    /cq\.Solid\.revolve\(cq\.Wire\.assembleEdges/,
  );
  assert.match(revolveResult.code, /cq\.Edge\.makeBezier\(/);

  const loftSpec = spec([
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
              { x: -2, y: -2 },
              { x: 2, y: -2 },
              { x: 2, y: 2 },
              { x: -2, y: 2 },
            ],
            z: 10,
          },
        ],
      },
    },
  ]);
  assert.deepEqual(validatePrintSpec(loftSpec), { valid: true, errors: [] });
  const loftResult = generateCadQuery(loftSpec);
  assert.equal(loftResult.supported, true);
  assert.match(loftResult.code, /cq\.Solid\.makeLoft\(\[/);

  const sweptSpec = spec([
    {
      id: "channel",
      kind: "swept_profile",
      operation: "add",
      dimensions: {
        profile: [
          { x: -2, y: -2 },
          { x: 2, y: -2 },
          { x: 2, y: 2 },
          { x: -2, y: 2 },
        ],
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 10 },
          { x: 10, y: 0, z: 10 },
        ],
      },
    },
  ]);
  assert.deepEqual(validatePrintSpec(sweptSpec), { valid: true, errors: [] });
  const sweptResult = generateCadQuery(sweptSpec);
  assert.equal(sweptResult.supported, true);
  // transitionMode="round" is always passed -- real-kernel testing found
  // the default ("transformed") and the profile/path's first segment must
  // be parallel to Z, the same requirements brepjs's own sweep() has.
  assert.match(sweptResult.code, /transitionMode="round"/);
});

test("composable-part cadquery generator implements hole/slot/counterbore/countersink and add/subtract/intersect", () => {
  const s = spec(
    [
      {
        id: "block",
        kind: "box",
        operation: "add",
        dimensions: { length: 40, width: 40, height: 20 },
      },
      {
        id: "groove",
        kind: "torus",
        operation: "subtract",
        position: { x: 0, y: 0, z: 7 },
        dimensions: { outerDiameter: 30, tubeDiameter: 6 },
      },
    ],
    [
      {
        id: "h",
        kind: "hole",
        target: "block",
        relation: { type: "centered_on", target: "block" },
        parameters: { diameter: 5, depth: "through" },
      },
      {
        id: "cb",
        kind: "counterbore",
        target: "h",
        parameters: { diameter: 10, depth: 3 },
      },
      {
        id: "cs",
        kind: "countersink",
        target: "h",
        parameters: { diameter: 10, angle: 90 },
      },
    ],
  );
  assert.deepEqual(validatePrintSpec(s), { valid: true, errors: [] });
  const r = generateCadQuery(s);
  assert.equal(r.supported, true);
  assert.deepEqual(
    r.warnings.filter((w) => !w.includes("centered on its resolved position")),
    [],
  );
  assert.match(r.code, /cq\.Solid\.makeCylinder\(2\.5, 1000\.2\)/);
  assert.match(r.code, /cq\.Solid\.makeCone\(/);
  assert.match(r.code, /\.cut\(cut_groove_\d+\)/);
});

test("composable-part cadquery generator implements fillet/chamfer/shell with the same support matrix as brepjs", () => {
  const boxAll = spec(
    [
      {
        id: "a",
        kind: "box",
        operation: "add",
        dimensions: { length: 20, width: 20, height: 10 },
      },
    ],
    [
      {
        id: "f",
        kind: "fillet",
        target: "a",
        parameters: { radius: 3, edges: "all" },
      },
    ],
  );
  const boxAllResult = generateCadQuery(boxAll);
  assert.deepEqual(boxAllResult.warnings, []);
  assert.match(boxAllResult.code, /\.fillet\(3, list\(.*\.edges\(\)\)\)/);

  const cylinderAll = spec(
    [
      {
        id: "a",
        kind: "cylinder",
        operation: "add",
        dimensions: { diameter: 20, height: 10 },
      },
    ],
    [
      {
        id: "f",
        kind: "fillet",
        target: "a",
        parameters: { radius: 3, edges: "all" },
      },
    ],
  );
  const cylinderAllResult = generateCadQuery(cylinderAll);
  assert.match(
    cylinderAllResult.warnings.join(" "),
    /does not support edges "all" in the composable_part CadQuery generator/,
  );

  const vertical = spec(
    [
      {
        id: "a",
        kind: "box",
        operation: "add",
        dimensions: { length: 20, width: 20, height: 10 },
        rotation: { x: 30, y: 0, z: 0 },
      },
    ],
    [
      {
        id: "f",
        kind: "chamfer",
        target: "a",
        parameters: { distance: 2, edges: "vertical" },
      },
    ],
  );
  const verticalResult = generateCadQuery(vertical);
  assert.deepEqual(verticalResult.warnings, []);
  assert.match(
    verticalResult.code,
    /cq\.ParallelDirSelector\(cq\.Vector\(0, -0\.4999\d*, 0\.8660254\d*\)/,
  );
  assert.match(verticalResult.code, /\.chamfer\(2, None, list\(/);

  const shell = spec(
    [
      {
        id: "a",
        kind: "box",
        operation: "add",
        dimensions: { length: 20, width: 20, height: 10 },
      },
    ],
    [
      {
        id: "s",
        kind: "shell",
        target: "a",
        parameters: { thickness: 2, openFaces: ["top"] },
      },
    ],
  );
  const shellResult = generateCadQuery(shell);
  assert.deepEqual(shellResult.warnings, []);
  assert.match(
    shellResult.code,
    /\.hollow\(\[\n\s*\w+\.faces\(cq\.NearestToPointSelector/,
  );
  assert.match(shellResult.code, /, -2\)/);
});

test("composable-part cadquery generator supports patterns, groups, and relations", () => {
  const patterned = spec([
    {
      id: "a",
      kind: "box",
      operation: "add",
      dimensions: { length: 10, width: 10, height: 5 },
      pattern: { type: "linear", axis: "x", count: 3, spacing: 20 },
    },
  ]);
  assert.deepEqual(validatePrintSpec(patterned), { valid: true, errors: [] });
  const patternedResult = generateCadQuery(patterned);
  assert.equal(patternedResult.supported, true);
  assert.match(
    patternedResult.code,
    /\.translate\(\(-20, 0, 0\)\)\.fuse\(.*\.translate\(\(0, 0, 0\)\)\)\.fuse\(.*\.translate\(\(20, 0, 0\)\)\)/,
  );

  const grouped = spec(
    [
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
    [],
    [
      {
        id: "g",
        memberIds: ["a", "b"],
        position: { x: 20, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 45 },
      },
    ],
  );
  assert.deepEqual(validatePrintSpec(grouped), { valid: true, errors: [] });
  const groupedResult = generateCadQuery(grouped);
  assert.equal(groupedResult.supported, true);
  assert.match(groupedResult.code, /\.rotate\(\(0, 0, 0\), \(0, 0, 1\), 45\)/);
});

test("composable-part cadquery generator supports options.isolate the same way as brepjs", () => {
  const s = spec([
    {
      id: "plate",
      kind: "cylinder",
      operation: "add",
      dimensions: { diameter: 40, height: 8 },
    },
    {
      id: "groove",
      kind: "torus",
      operation: "subtract",
      position: { x: 0, y: 0, z: 6.5 },
      dimensions: { outerDiameter: 31, tubeDiameter: 3 },
    },
  ]);
  const whole = generateCadQuery(s);
  assert.equal(whole.supported, true);

  const isolatePlate = generateCadQuery(s, { isolate: "plate" });
  assert.equal(isolatePlate.supported, true);
  assert.match(isolatePlate.code, /^part = comp_plate_cut_\d+$/m);

  const missing = generateCadQuery(s, { isolate: "nope" });
  assert.equal(missing.supported, false);
  assert.match(
    missing.message,
    /no component, feature, or group with a standalone shape found for id "nope"/,
  );

  const plateSpec = {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "rounded_rectangular_plate",
      label: "isolate non-composable test",
      parameters: { length: 20, width: 20, thickness: 4, cornerRadius: 2 },
    },
  };
  const isolateNonComposable = generateCadQuery(plateSpec, {
    isolate: "anything",
  });
  assert.equal(isolateNonComposable.supported, false);
  assert.match(
    isolateNonComposable.message,
    /isolate is only supported for composable_part specs/,
  );
});

test("composable-part cadquery generator warns and skips unimplemented thread/text features", () => {
  const threadSpec = spec(
    [
      {
        id: "post",
        kind: "boss",
        operation: "add",
        dimensions: { diameter: 12, height: 10 },
      },
    ],
    [
      {
        id: "t",
        kind: "thread",
        target: "post",
        parameters: { pitch: 2, height: 10 },
      },
    ],
  );
  assert.deepEqual(validatePrintSpec(threadSpec), { valid: true, errors: [] });
  const threadResult = generateCadQuery(threadSpec);
  assert.equal(threadResult.supported, true);
  assert.match(
    threadResult.warnings.join(" "),
    /feature t \(thread\) is not implemented by the composable_part CadQuery generator/,
  );
  // The base geometry is still emitted -- only the thread itself is skipped.
  assert.match(threadResult.code, /cq\.Solid\.makeCylinder\(6, 10\)/);

  const textSpec = spec(
    [
      {
        id: "a",
        kind: "box",
        operation: "add",
        dimensions: { length: 20, width: 20, height: 6 },
      },
    ],
    [
      {
        id: "label",
        kind: "text",
        target: "a",
        parameters: {
          content: "Hi",
          depth: 0.6,
          fontUrl: "https://example.com/font.ttf",
        },
      },
    ],
  );
  const textResult = generateCadQuery(textSpec);
  assert.equal(textResult.supported, true);
  assert.match(
    textResult.warnings.join(" "),
    /feature label \(text\) is not implemented by the composable_part CadQuery generator/,
  );
});
