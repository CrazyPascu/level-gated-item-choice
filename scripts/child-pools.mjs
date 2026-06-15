import { ADVANCEMENT_TYPE } from "./constants.mjs";
import { debugChildSearch } from "./utils/i18n.mjs";
import {
  getAdvancementConfiguration,
  getAdvancementId,
  getAdvancementPool,
  getAdvancementType,
  getFollowUpItemUuidsFromAdvancement,
  getItemAdvancements
} from "./utils/advancement.mjs";
import { cleanPoolId, normalizePoolRole } from "./utils/pool.mjs";

export async function collectMatchingChildPoolsFromItem(item, parentPoolId, {
  currentAdvancement=null,
  depth=0,
  maxDepth=10,
  seenItems=new Set(),
  seenPoolKeys=new Set(),
  origin=null
}={}) {
  const pools = [];
  if ( !item || !parentPoolId || depth > maxDepth ) return pools;

  const itemKey = item.uuid ?? item.id ?? item.name;
  if ( !itemKey || seenItems.has(itemKey) ) return pools;
  seenItems.add(itemKey);

  const currentId = getAdvancementId(currentAdvancement);
  const advancements = getItemAdvancements(item);

  debugChildSearch("recursive item scan", {
    origin,
    depth,
    item: item.name,
    itemUuid: item.uuid,
    advancementCount: advancements.length
  });

  const nextUuids = new Set();

  for ( const advancement of advancements ) {
    const configuration = getAdvancementConfiguration(advancement);
    const type = getAdvancementType(advancement);
    const role = normalizePoolRole(configuration.poolRole);
    const childParentPoolId = cleanPoolId(configuration.parentPoolId);
    const advancementId = getAdvancementId(advancement);
    const pool = getAdvancementPool(advancement);
    const followUpUuids = getFollowUpItemUuidsFromAdvancement(advancement);

    debugChildSearch("recursive advancement inspected", {
      origin,
      depth,
      item: item.name,
      itemUuid: item.uuid,
      advancementId,
      type,
      role,
      parentPoolId: childParentPoolId,
      poolSize: pool.length,
      followUpUuids,
      matches: (type === ADVANCEMENT_TYPE) && (role === "child") && (childParentPoolId === parentPoolId)
    });

    if ( (type === ADVANCEMENT_TYPE) && (role === "child") && (childParentPoolId === parentPoolId) ) {
      if ( advancementId !== currentId ) {
        const key = `${item.uuid ?? item.id ?? "item"}.${advancementId ?? foundry.utils.randomID()}`;
        if ( !seenPoolKeys.has(key) ) {
          seenPoolKeys.add(key);
          pools.push(pool);
          debugChildSearch("recursive child pool added", {
            origin,
            depth,
            item: item.name,
            itemUuid: item.uuid,
            advancementId,
            poolSize: pool.length
          });
        }
      }
    }

    for ( const uuid of followUpUuids ) nextUuids.add(uuid);
  }

  for ( const uuid of nextUuids ) {
    const nextItem = await fromUuid(uuid);
    if ( !nextItem ) {
      debugChildSearch("recursive follow-up unresolved", { origin, depth, uuid });
      continue;
    }

    const nestedPools = await collectMatchingChildPoolsFromItem(nextItem, parentPoolId, {
      currentAdvancement,
      depth: depth + 1,
      maxDepth,
      seenItems,
      seenPoolKeys,
      origin: origin ?? item.uuid ?? item.name
    });
    pools.push(...nestedPools);
  }

  return pools;
}
