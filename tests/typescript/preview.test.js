import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

const familyFiles = {
  round_spacer: "round-spacer.basic.json",
  spacer_block: "spacer-block.four-hole.json",
  electronics_standoff: "electronics-standoff.m3.json",
  rounded_rectangular_plate: "rounded-rectangular-plate.basic.json",
  cable_comb: "cable-comb.usb.json",
  cable_clip: "cable-clip.basic.json",
  wall_mount_bracket: "wall-mount-bracket.basic.json",
  l_bracket: "l-bracket.basic.json",
  drawer_divider: "drawer-divider.basic.json",
  project_enclosure_tray: "project-enclosure-tray.basic.json",
};

const specs = Object.fromEntries(
  Object.entries(familyFiles).map(([type, file]) => [type, read(`examples/part-families/${file}`)]),
);
const box = (scene, id) =>
  scene.objects.find(
    (object) => object.id === id && (object.kind === "box" || object.kind === "roundedBox"),
  );
const byKind = (scene, kind) => scene.objects.filter((object) => object.kind === kind);

test("preview scene generator supports all PartPilot-visible families", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  for (const [partType, spec] of Object.entries(specs)) {
    const preview = generatePreviewScene(spec);
    assert.equal(preview.supported, true, partType);
    assert.equal(preview.scene.units, "mm", partType);
    assert.equal(preview.scene.partType, partType);
    assert.equal(preview.scene.label, spec.part.label, partType);
    assert.ok(preview.scene.objects.length > 0, partType);
    assert.ok(
      preview.scene.warnings.some((warning) => warning.includes("approximate")),
      partType,
    );
  }
});

test("rounded rectangular plate preview uses roundedBox with expected radius", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const preview = generatePreviewScene(specs.rounded_rectangular_plate);
  const p = specs.rounded_rectangular_plate.part.parameters;
  const body = preview.scene.objects.find((o) => o.id === "body");
  assert.equal(body.kind, "roundedBox");
  assert.deepEqual(body.dimensionsMm, { x: p.length, y: p.width, z: p.thickness });
  assert.equal(body.radiusMm, p.cornerRadius);
});

test("project enclosure tray preview exposes tray walls, cavity, bounds, and mount markers", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const preview = generatePreviewScene(specs.project_enclosure_tray);
  const { outerWidth, outerDepth, floorThickness, wallThickness, wallHeight } =
    specs.project_enclosure_tray.part.parameters;
  assert.equal(preview.supported, true);
  assert.deepEqual(preview.scene.boundsMm, {
    x: outerWidth,
    y: outerDepth,
    z: floorThickness + wallHeight,
  });
  for (const id of ["floor", "front-wall", "back-wall", "left-wall", "right-wall"])
    assert.ok(box(preview.scene, id), id);
  assert.equal(box(preview.scene, "floor").kind, "roundedBox");
  assert.equal(
    box(preview.scene, "floor").radiusMm,
    specs.project_enclosure_tray.part.parameters.cornerRadius,
  );
  assert.deepEqual(box(preview.scene, "floor").dimensionsMm, {
    x: outerWidth,
    y: outerDepth,
    z: floorThickness,
  });
  assert.equal(box(preview.scene, "front-wall").dimensionsMm.y, wallThickness);
  assert.equal(box(preview.scene, "left-wall").dimensionsMm.x, wallThickness);
  assert.equal(
    byKind(preview.scene, "hole_marker").filter((o) => o.id.startsWith("mount-hole-")).length,
    4,
  );
  assert.ok(preview.scene.objects.some((o) => o.id === "inner-cavity" && o.kind === "slot_marker"));
});

test("cable comb preview shows one slot marker per generated slot", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const preview = generatePreviewScene(specs.cable_comb);
  const body = box(preview.scene, "body");
  assert.equal(body.kind, "roundedBox");
  assert.equal(body.radiusMm, specs.cable_comb.part.parameters.cornerRadius);
  const slots = byKind(preview.scene, "slot_marker").filter((o) => o.id.startsWith("slot-"));
  assert.equal(slots.length, specs.cable_comb.part.parameters.slotCount);
  assert.ok(
    slots.every((slot) => slot.dimensionsMm.x === specs.cable_comb.part.parameters.slotWidth),
  );
  assert.ok(
    slots.every((slot) => slot.dimensionsMm.y === specs.cable_comb.part.parameters.slotDepth),
  );
});

test("cable clip preview shows base, retaining jaws, cable channel, and opening gap", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const preview = generatePreviewScene(specs.cable_clip);
  assert.ok(box(preview.scene, "base"));
  for (const id of ["clip-top", "clip-left-jaw", "clip-right-jaw"])
    assert.ok(box(preview.scene, id), id);
  const channel = preview.scene.objects.find((o) => o.id === "cable-channel");
  assert.equal(channel.kind, "hole_marker");
  assert.equal(channel.radiusMm * 2, specs.cable_clip.part.parameters.clipInnerDiameter);
  const gap = preview.scene.objects.find((o) => o.id === "opening-gap");
  assert.equal(gap.kind, "slot_marker");
  assert.ok(gap.dimensionsMm.z > 0);
});

test("l bracket preview has two perpendicular legs with expected dimensions", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const preview = generatePreviewScene(specs.l_bracket);
  const p = specs.l_bracket.part.parameters;
  assert.deepEqual(box(preview.scene, "leg-a").dimensionsMm, {
    x: p.legLengthA,
    y: p.width,
    z: p.thickness,
  });
  assert.deepEqual(box(preview.scene, "leg-b").dimensionsMm, {
    x: p.thickness,
    y: p.width,
    z: p.legLengthB,
  });
});

test("wall mount bracket preview shows wall plate, projection, and screw hole markers", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const preview = generatePreviewScene(specs.wall_mount_bracket);
  const p = specs.wall_mount_bracket.part.parameters;
  assert.deepEqual(box(preview.scene, "wall-plate").dimensionsMm, {
    x: p.width,
    y: p.thickness,
    z: p.height,
  });
  assert.deepEqual(box(preview.scene, "tab").dimensionsMm, {
    x: p.width,
    y: p.tabDepth,
    z: p.thickness,
  });
  assert.equal(
    byKind(preview.scene, "hole_marker").filter((o) => o.id.startsWith("screw-hole-")).length,
    2,
  );
});

test("drawer divider preview shows divider panel and notch markers", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const preview = generatePreviewScene(specs.drawer_divider);
  const p = specs.drawer_divider.part.parameters;
  assert.deepEqual(box(preview.scene, "divider-panel").dimensionsMm, {
    x: p.length,
    y: p.thickness,
    z: p.height,
  });
  assert.equal(
    byKind(preview.scene, "slot_marker").filter((o) => o.id.startsWith("notch-")).length,
    p.notchCount,
  );
});

test("invalid specs fail cleanly", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const preview = generatePreviewScene({
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "round_spacer",
      label: "Bad",
      parameters: { outerDiameter: 4, innerDiameter: 8, height: 2 },
    },
  });
  assert.equal(preview.supported, false);
  assert.match(preview.message, /Invalid printspec/);
  assert.ok(preview.errors.length > 0);
});

test("preview and three dist files avoid Node built-in imports", () => {
  for (const rel of [
    "packages/typescript/dist/preview/index.js",
    "packages/typescript/dist/preview/generate.js",
    "packages/typescript/dist/preview/families.js",
    "packages/typescript/dist/three.js",
  ]) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(source, /from ['"](?:node:)?(?:fs|path|url)['"]/);
    assert.doesNotMatch(source, /import\(['"](?:node:)?(?:fs|path|url)['"]\)/);
  }
});

test("preview import is browser safe and browser entrypoint does not import three adapter", async () => {
  const preview = await import("../../packages/typescript/dist/preview/index.js");
  assert.equal(typeof preview.generatePreviewScene, "function");
  const browserSource = fs.readFileSync(
    path.join(root, "packages/typescript/dist/browser.js"),
    "utf8",
  );
  assert.doesNotMatch(browserSource, /three/);
  assert.doesNotMatch(browserSource, /preview/);
});

test("three adapter works with consumer-provided Three-like namespace", async () => {
  const { generatePreviewScene } = await import("../../packages/typescript/dist/preview/index.js");
  const { createThreePreviewObject } = await import("../../packages/typescript/dist/three.js");
  class Group {
    constructor() {
      this.children = [];
      this.name = "";
    }
    add(child) {
      this.children.push(child);
    }
  }
  class Geometry {
    constructor(...args) {
      this.args = args;
      this.translated = [];
    }
    translate(...args) {
      this.translated.push(args);
    }
  }
  class Shape {
    constructor() {
      this.commands = [];
    }
    moveTo(...args) {
      this.commands.push(["moveTo", ...args]);
    }
    lineTo(...args) {
      this.commands.push(["lineTo", ...args]);
    }
    quadraticCurveTo(...args) {
      this.commands.push(["quadraticCurveTo", ...args]);
    }
  }
  class Material {
    constructor(params) {
      this.params = params;
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.name = "";
      this.position = {
        set: (x, y, z) => {
          this.position.x = x;
          this.position.y = y;
          this.position.z = z;
        },
      };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
  }
  const THREE = {
    Group,
    BoxGeometry: Geometry,
    CylinderGeometry: Geometry,
    Shape,
    ExtrudeGeometry: Geometry,
    MeshBasicMaterial: Material,
    Mesh,
  };
  const preview = generatePreviewScene(specs.project_enclosure_tray);
  const group = createThreePreviewObject(preview.scene, THREE);
  assert.equal(group.children.length, preview.scene.objects.length);
  assert.equal(
    group.children.find((child) => child.name === "floor").geometry.args[1].curveSegments,
    12,
  );
});

test("preview and browser entrypoints do not import Three.js", () => {
  for (const rel of [
    "packages/typescript/dist/preview/index.js",
    "packages/typescript/dist/preview/generate.js",
    "packages/typescript/dist/preview/families.js",
    "packages/typescript/dist/browser.js",
  ]) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(source, /(?:from|import\() ['"]three['"]/);
    assert.doesNotMatch(source, /from ['"]\.\.\/three\.js['"]/);
    assert.doesNotMatch(source, /from ['"]\.\/three\.js['"]/);
  }
});
