/**
 * @vaep/config — programmatic entry point.
 *
 * The actual presets are plain JS/JSON so build tools can `require`/`extends` them:
 *   - tsconfig:  extends "@vaep/config/tsconfig"
 *   - eslint:    require("@vaep/config/eslint")
 *   - tailwind:  presets: [require("@vaep/config/tailwind")]
 *
 * This file just re-exports their resolvable paths for tooling that prefers imports.
 */
export const configPaths = {
  tsconfig: '@vaep/config/tsconfig',
  eslint: '@vaep/config/eslint',
  tailwind: '@vaep/config/tailwind',
} as const;

export type VaepConfigPaths = typeof configPaths;
