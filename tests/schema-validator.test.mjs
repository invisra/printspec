import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const bundlePath = "public/printspec/validator/validator.js";
const htmlPath = "public/printspec/validator/index.html";
const forbidden = [
  "node:fs",
  "node:path",
  "node:url",
  'require("fs")',
  'require("path")',
  'require("url")',
];

const examples = {
  round_spacer: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "round_spacer",
      label: "Round spacer",
      parameters: { outerDiameter: 12, innerDiameter: 4, height: 8 },
    },
  },
  spacer_block: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "spacer_block",
      label: "Spacer block",
      parameters: {
        length: 40,
        width: 20,
        height: 8,
        holes: [{ x: -10, y: 0, diameter: 3, depth: "through" }],
      },
    },
  },
  electronics_standoff: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "electronics_standoff",
      label: "Electronics standoff",
      parameters: {
        outerDiameter: 8,
        height: 10,
        holeDiameter: 3,
        baseDiameter: 12,
        baseHeight: 2,
      },
    },
  },
  rounded_rectangular_plate: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "rounded_rectangular_plate",
      label: "Rounded rectangular plate",
      parameters: {
        length: 80,
        width: 40,
        thickness: 3,
        cornerRadius: 4,
        holes: [{ x: 20, y: 10, diameter: 3, depth: "through" }],
      },
    },
  },
  cable_comb: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "cable_comb",
      label: "Cable comb",
      parameters: {
        length: 70,
        width: 18,
        thickness: 4,
        slotCount: 5,
        slotWidth: 5,
        slotSpacing: 12,
        slotDepth: 12,
      },
    },
  },
  cable_clip: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "cable_clip",
      label: "Cable clip",
      parameters: {
        baseLength: 30,
        baseWidth: 14,
        baseThickness: 3,
        clipInnerDiameter: 8,
        clipWallThickness: 2,
      },
    },
  },
  wall_mount_bracket: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "wall_mount_bracket",
      label: "Wall mount bracket",
      parameters: {
        width: 40,
        height: 60,
        thickness: 4,
        tabDepth: 20,
        screwHoleDiameter: 4,
        screwHoleSpacing: 36,
        cornerRadius: 3,
      },
    },
  },
  l_bracket: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "l_bracket",
      label: "L bracket",
      parameters: { legLengthA: 40, legLengthB: 30, width: 20, thickness: 4 },
    },
  },
  drawer_divider: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "drawer_divider",
      label: "Drawer divider",
      parameters: {
        length: 120,
        height: 40,
        thickness: 3,
        notchCount: 2,
        notchWidth: 3,
        notchDepth: 10,
        endTab: false,
      },
    },
  },
  project_enclosure_tray: {
    printspecVersion: "0.2.0",
    units: "mm",
    part: {
      type: "project_enclosure_tray",
      label: "Project enclosure tray",
      parameters: {
        outerWidth: 80,
        outerDepth: 50,
        wallHeight: 15,
        wallThickness: 3,
        floorThickness: 3,
        cornerRadius: 4,
        mountHoleDiameter: 3,
        mountHoleInset: 8,
      },
    },
  },
};

test("schema validator static files are built without Node built-ins", () => {
  assert.ok(existsSync(htmlPath), `${htmlPath} should exist`);
  assert.ok(existsSync(bundlePath), `${bundlePath} should exist`);
  const bundle = readFileSync(bundlePath, "utf8");
  for (const pattern of forbidden)
    assert.equal(
      bundle.includes(pattern),
      false,
      `${pattern} must not be bundled`,
    );
  assert.match(bundle, /printspec-validator-real-browser-api-v1/);
  assert.match(bundle, /round_spacer/);
  assert.match(bundle, /project_enclosure_tray/);
  assert.match(bundle, /Valid PrintSpec JSON/);
  assert.match(bundle, /Invalid PrintSpec JSON/);
});

test("schema validator HTML includes Invisra static branding", () => {
  const html = readFileSync(htmlPath, "utf8");
  assert.match(
    html,
    /https:\/\/assets\.invisra\.ai\/brand\/v4\/brand\.min\.css/,
  );
  assert.match(html, /https:\/\/assets\.invisra\.ai\/brand\/v4\/favicon\.svg/);
  // The wordmark is a published asset from brand v3 on; the live-text
  // .invisra-logo-wordmark class it replaced no longer exists in the CSS.
  assert.match(html, /class="invisra-wordmark"/);
  assert.doesNotMatch(html, /invisra-logo-wordmark/);
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.match(html, /Invisra/);
  assert.match(html, /printspec validator/);
  assert.match(
    html,
    /<script type="module" src="\.\/validator\.js"><\/script>/,
  );
  const css = readFileSync("public/printspec/validator/style.css", "utf8");
  assert.match(css, /html\[data-theme=light\] body\.invisra-theme/);
  assert.match(css, /html\[data-theme=light\] \.invisra-shell/);
});

test("validator examples validate through browser-safe API", async () => {
  const { validatePrintSpec, listPartFamilies, getPartFamilyFormMetadata } =
    await import("../packages/typescript/dist/browser.js");
  assert.ok(
    listPartFamilies().some((family) => family.type === "round_spacer"),
  );
  for (const [type, spec] of Object.entries(examples)) {
    assert.equal(getPartFamilyFormMetadata(type).partType, type);
    const result = validatePrintSpec(spec);
    assert.deepEqual(result, { valid: true, errors: [] }, type);
  }
});
