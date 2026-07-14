import { validatePrintSpec } from "../validate.browser.js";
import type { PartFamilySpec, PrintSpec } from "../types.js";
import type { PreviewGenerationResult, PreviewScene } from "./types.js";
import {
  buildCableClipPreview,
  buildCableCombPreview,
  buildDrawerDividerPreview,
  buildElectronicsStandoffPreview,
  buildLBracketPreview,
  buildProjectEnclosureTrayPreview,
  buildRoundSpacerPreview,
  buildRoundedRectangularPlatePreview,
  buildSpacerBlockPreview,
  buildWallMountBracketPreview,
} from "./families.js";

const builders: Record<string, (part: PartFamilySpec) => PreviewScene> = {
  round_spacer: buildRoundSpacerPreview,
  spacer_block: buildSpacerBlockPreview,
  electronics_standoff: buildElectronicsStandoffPreview,
  rounded_rectangular_plate: buildRoundedRectangularPlatePreview,
  cable_comb: buildCableCombPreview,
  cable_clip: buildCableClipPreview,
  wall_mount_bracket: buildWallMountBracketPreview,
  l_bracket: buildLBracketPreview,
  drawer_divider: buildDrawerDividerPreview,
  project_enclosure_tray: buildProjectEnclosureTrayPreview,
};

export function generatePreviewScene(spec: unknown): PreviewGenerationResult {
  const validation = validatePrintSpec(spec);
  if (!validation.valid)
    return {
      supported: false,
      message: "Invalid printspec; preview scene was not generated.",
      warnings: [],
      errors: validation.errors,
    };
  const normalized = spec as PrintSpec;
  if (normalized.units !== "mm")
    return {
      supported: false,
      message: "Preview scenes currently support millimeter printspecs only.",
      warnings: [],
    };
  const part = normalized.part;
  if (!part || !("parameters" in part))
    return {
      supported: false,
      message: "Preview scenes currently support selected part-family specs only.",
      warnings: [],
    };
  const build = builders[part.type];
  if (!build)
    return {
      supported: false,
      message: `Preview is not supported for part type: ${part.type}.`,
      warnings: [],
    };
  const scene = build(part);
  return { supported: true, scene, warnings: scene.warnings };
}
