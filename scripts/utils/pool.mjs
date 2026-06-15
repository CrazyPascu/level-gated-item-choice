import { MAX_SECTION_LEVEL } from "../constants.mjs";
import { clampLevel } from "./levels.mjs";
import { t } from "./i18n.mjs";

export function sortItemsByName(items) {
  return items.sort((a, b) => {
    const nameA = String(a.item?.name ?? a.name ?? a.label ?? a.uuid ?? "");
    const nameB = String(b.item?.name ?? b.name ?? b.label ?? b.uuid ?? "");

    return nameB.localeCompare(nameA, game.i18n.lang, {
      sensitivity: "base",
      numeric: true
    });
  });
}

export function normalizePoolRole(value) {
  return ["standalone", "parent", "child"].includes(value) ? value : "standalone";
}

export function cleanPoolId(value) {
  return String(value ?? "").trim();
}

export function cleanSectionTitle(value) {
  return String(value ?? "").trim();
}

export function getSectionTitles(configuration) {
  const titles = configuration?.sectionTitles ?? {};
  return titles?.toObject?.() ?? titles;
}

export function getSectionTitle(configuration, level, { flow=false, fallback=true }={}) {
  const title = cleanSectionTitle(getSectionTitles(configuration)?.[level]);
  if ( title ) return title;
  if ( !fallback ) return "";
  return flow ? t("LGIC.Flow.AvailableFromLevel", { level }) : t("LGIC.Config.LevelLabel", { level });
}

export function normalizePoolEntry(entry, maxLevel = MAX_SECTION_LEVEL) {
  if ( !entry?.uuid ) return null;

  const rawMin = entry.minLevel;
  const min = [undefined, null, ""].includes(rawMin) ? 1 : Number(rawMin);

  return {
    uuid: entry.uuid,
    minLevel: clampLevel(Number.isFinite(min) ? min : 1, maxLevel)
  };
}

export function mergePools(pools, maxLevel = MAX_SECTION_LEVEL) {
  const merged = new Map();

  for ( const pool of pools ) {
    for ( const rawEntry of pool ?? [] ) {
      const entry = normalizePoolEntry(rawEntry, maxLevel);
      if ( !entry ) continue;

      const existing = merged.get(entry.uuid);
      if ( existing ) existing.minLevel = Math.min(existing.minLevel, entry.minLevel);
      else merged.set(entry.uuid, entry);
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    return (a.minLevel - b.minLevel) || a.uuid.localeCompare(b.uuid);
  });
}
