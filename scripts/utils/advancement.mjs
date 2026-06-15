import { ADVANCEMENT_TYPE } from "../constants.mjs";
import { cleanPoolId, normalizePoolRole } from "./pool.mjs";

export function getSelectedSourceUuids(advancement) {
  const value = advancement?.value ?? advancement?.data?.value ?? advancement?.toObject?.()?.value ?? {};
  const added = value.added ?? {};
  const uuids = new Set();

  const collect = source => {
    if ( !source ) return;
    if ( typeof source === "string" ) {
      uuids.add(source);
      return;
    }
    if ( Array.isArray(source) ) {
      for ( const entry of source ) collect(entry);
      return;
    }
    if ( typeof source === "object" ) {
      for ( const entry of Object.values(source) ) collect(entry);
    }
  };

  collect(added);
  return Array.from(uuids);
}

export function getSelectedSourceUuidsFromActor(actor) {
  const uuids = new Set();

  for ( const item of actor?.items ?? [] ) {
    for ( const advancement of getItemAdvancements(item) ) {
      for ( const uuid of getSelectedSourceUuids(advancement) ) {
        uuids.add(uuid);
      }
    }
  }

  return Array.from(uuids);
}

export function getSelectedSourceUuidsFromManager(manager) {
  const uuids = new Set();

  for ( const step of manager?.steps ?? [] ) {
    const advancement = step?.flow?.advancement;
    for ( const uuid of getSelectedSourceUuids(advancement) ) uuids.add(uuid);
  }

  return Array.from(uuids);
}

export function looksLikeUuid(value) {
  if ( typeof value !== "string" ) return false;
  return /^(Actor|Item|Compendium|Scene|JournalEntry|Macro|RollTable)\./.test(value);
}

export function collectUuidsDeep(value, { maxDepth=6, seen=new WeakSet() }={}) {
  const uuids = new Set();

  const collect = (entry, depth) => {
    if ( depth > maxDepth || entry == null ) return;

    if ( typeof entry === "string" ) {
      if ( looksLikeUuid(entry) ) uuids.add(entry);
      return;
    }

    if ( typeof entry !== "object" ) return;
    if ( seen.has(entry) ) return;
    seen.add(entry);

    if ( looksLikeUuid(entry.uuid) ) uuids.add(entry.uuid);

    if ( entry instanceof Map ) {
      for ( const [key, val] of entry.entries() ) {
        collect(key, depth + 1);
        collect(val, depth + 1);
      }
      return;
    }

    if ( entry instanceof Set ) {
      for ( const val of entry.values() ) collect(val, depth + 1);
      return;
    }

    if ( Array.isArray(entry) ) {
      for ( const val of entry ) collect(val, depth + 1);
      return;
    }

    for ( const [key, val] of Object.entries(entry) ) {
      if ( key.startsWith("_") && key !== "_id" ) continue;
      collect(val, depth + 1);
    }
  };

  collect(value, 0);
  return Array.from(uuids);
}

export function getCandidateActors(advancement, manager) {
  const actors = [];
  if ( advancement?.actor ) actors.push(advancement.actor);
  if ( manager?.clone && !actors.includes(manager.clone) ) actors.push(manager.clone);
  return actors;
}

export function getChildAdvancementsFromActor(actor, parentPoolId, currentAdvancement) {
  if ( !actor || !parentPoolId ) return [];

  const children = [];
  const currentId = getAdvancementId(currentAdvancement);

  for ( const item of actor.items ?? [] ) {
    for ( const advancement of getItemAdvancements(item) ) {
      if ( getAdvancementType(advancement) !== ADVANCEMENT_TYPE ) continue;
      if ( getAdvancementId(advancement) === currentId ) continue;

      const configuration = getAdvancementConfiguration(advancement);
      if ( normalizePoolRole(configuration.poolRole) !== "child" ) continue;
      if ( cleanPoolId(configuration.parentPoolId) !== parentPoolId ) continue;

      children.push(advancement);
    }
  }

  return children;
}

export function getAdvancementId(advancement) {
  return advancement?.id ?? advancement?._id ?? advancement?.data?._id ?? advancement?.toObject?.()?._id ?? null;
}

export function getAdvancementType(advancement) {
  return advancement?.type ?? advancement?.constructor?.typeName ?? advancement?.data?.type ?? advancement?.toObject?.()?.type ?? null;
}

export function getAdvancementConfiguration(advancement) {
  return advancement?.configuration ?? advancement?.data?.configuration ?? advancement?.toObject?.()?.configuration ?? {};
}

export function getAdvancementPool(advancement) {
  const pool = getAdvancementConfiguration(advancement).pool ?? [];
  return Array.isArray(pool) ? pool : Object.values(pool);
}

export function getItemAdvancements(item) {
  if ( !item ) return [];

  const parsed = item.advancement;
  if ( parsed?.contents ) return Array.from(parsed.contents);
  if ( parsed?.byId ) {
    if ( typeof parsed.byId.values === "function" ) return Array.from(parsed.byId.values());
    return Object.values(parsed.byId);
  }
  if ( typeof parsed?.values === "function" ) return Array.from(parsed.values());
  if ( Array.isArray(parsed) ) return parsed;

  const advancements = item.system?.advancement;
  if ( !advancements ) return [];
  if ( Array.isArray(advancements) ) return advancements;
  if ( typeof advancements.values === "function" ) return Array.from(advancements.values());

  return Object.values(advancements);
}

export function collectGrantEntryUuids(entries) {
  const uuids = new Set();
  const collect = entry => {
    if ( !entry ) return;
    if ( typeof entry === "string" ) {
      if ( looksLikeUuid(entry) ) uuids.add(entry);
      return;
    }
    if ( Array.isArray(entry) ) {
      for ( const value of entry ) collect(value);
      return;
    }
    if ( typeof entry !== "object" ) return;
    if ( looksLikeUuid(entry.uuid) ) uuids.add(entry.uuid);
  };

  collect(entries);
  return Array.from(uuids);
}

export function getFollowUpItemUuidsFromAdvancement(advancement) {
  const configuration = getAdvancementConfiguration(advancement);
  const type = getAdvancementType(advancement);
  const uuids = new Set();

  for ( const uuid of getSelectedSourceUuids(advancement) ) uuids.add(uuid);
  for ( const uuid of collectGrantEntryUuids(configuration.items) ) uuids.add(uuid);

  if ( type !== ADVANCEMENT_TYPE ) {
    for ( const uuid of collectGrantEntryUuids(configuration.pool) ) uuids.add(uuid);
  }

  return Array.from(uuids);
}
