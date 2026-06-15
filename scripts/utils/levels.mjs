import { MAX_SECTION_LEVEL } from "../constants.mjs";

export function clampLevel(value, maxLevel = MAX_SECTION_LEVEL) {
  const numeric = Number(value);
  if ( !Number.isFinite(numeric) ) return 1;
  return Math.min(Math.max(Math.trunc(numeric), 1), maxLevel);
}

export function getMaxSectionLevel() {
  return Math.min(Number(CONFIG.DND5E?.maxLevel ?? MAX_SECTION_LEVEL), MAX_SECTION_LEVEL) || MAX_SECTION_LEVEL;
}
