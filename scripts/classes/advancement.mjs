import { ADVANCEMENT_TYPE } from "../constants.mjs";
import { collectMatchingChildPoolsFromItem } from "../child-pools.mjs";
import { getMaxSectionLevel } from "../utils/levels.mjs";
import { debugChildSearch } from "../utils/i18n.mjs";
import {
  collectUuidsDeep,
  getAdvancementConfiguration,
  getAdvancementId,
  getAdvancementPool,
  getCandidateActors,
  getChildAdvancementsFromActor,
  getItemAdvancements,
  getSelectedSourceUuids,
  getSelectedSourceUuidsFromActor,
  getSelectedSourceUuidsFromManager
} from "../utils/advancement.mjs";
import {
  cleanPoolId,
  getSectionTitle,
  mergePools,
  normalizePoolRole
} from "../utils/pool.mjs";

export function createAdvancementClass(ItemChoiceAdvancement, {
  LGICLevelGatedItemChoiceConfigurationData,
  LGICLevelGatedItemChoiceConfig,
  LGICLevelGatedItemChoiceFlow,
  ItemChoiceValueData
}) {
  return class LGICLevelGatedItemChoiceAdvancement extends ItemChoiceAdvancement {
    static get typeName() {
      return ADVANCEMENT_TYPE;
    }

    static get metadata() {
      return foundry.utils.mergeObject(super.metadata, {
        dataModels: {
          configuration: LGICLevelGatedItemChoiceConfigurationData,
          value: ItemChoiceValueData
        },
        order: 51,
        icon: "icons/magic/symbols/cog-orange-red.webp",
        typeIcon: "systems/dnd5e/icons/svg/item-choice.svg",
        title: game.i18n.localize("LGIC.Advancement.Title"),
        hint: game.i18n.localize("LGIC.Advancement.Hint"),
        multiLevel: true,
        apps: {
          config: LGICLevelGatedItemChoiceConfig,
          flow: LGICLevelGatedItemChoiceFlow
        }
      }, { inplace: false });
    }

    get poolRole() {
      return normalizePoolRole(this.configuration.poolRole);
    }

    get isPoolParent() {
      return this.poolRole === "parent";
    }

    get isPoolChild() {
      return this.poolRole === "child";
    }

    get poolId() {
      return cleanPoolId(this.configuration.poolId);
    }

    get parentPoolId() {
      return cleanPoolId(this.configuration.parentPoolId);
    }

    get levels() {
      if ( this.isPoolChild ) return [];
      return super.levels;
    }

    getRegionTitle(level, { flow=false }={}) {
      return getSectionTitle(this.configuration, level, { flow, fallback: true });
    }

    async preparePendingChildPools({ manager=null, extraUuids=[] }={}) {
      this._lgicPendingChildPools = [];
      if ( !this.isPoolParent || !this.poolId ) {
        debugChildSearch("skipped", {
          reason: !this.isPoolParent ? "not-parent" : "missing-pool-id",
          item: this.item?.name,
          advancementId: getAdvancementId(this)
        });
        return [];
      }

      manager?.clone?.reset?.();
      this.actor?.reset?.();

      const pools = [];
      const seenPoolKeys = new Set();
      const currentSelectionUuids = getSelectedSourceUuids(this);
      const managerSelectionUuids = getSelectedSourceUuidsFromManager(manager);
      const deepManagerUuids = collectUuidsDeep(manager, { maxDepth: 6 });
      const pendingUuids = new Set([
        ...currentSelectionUuids,
        ...managerSelectionUuids,
        ...deepManagerUuids,
        ...extraUuids
      ]);

      debugChildSearch("start", {
        parentItem: this.item?.name,
        parentPoolId: this.poolId,
        advancementId: getAdvancementId(this),
        managerSteps: manager?.steps?.length ?? null,
        currentSelectionUuids,
        managerSelectionUuids,
        deepManagerUuids,
        extraUuids,
        pendingUuids: Array.from(pendingUuids)
      });

      const actors = getCandidateActors(this, manager);
      debugChildSearch("candidate actors", actors.map(actor => ({
        name: actor?.name,
        id: actor?.id,
        uuid: actor?.uuid,
        itemCount: actor?.items?.size ?? actor?.items?.length ?? 0
      })));

      for ( const actor of actors ) {
        for ( const uuid of getSelectedSourceUuidsFromActor(actor) ) pendingUuids.add(uuid);

        const actorChildren = getChildAdvancementsFromActor(actor, this.poolId, this);
        debugChildSearch("actor children found", {
          actor: actor?.name,
          count: actorChildren.length,
          children: actorChildren.map(child => ({
            item: child.item?.name,
            itemUuid: child.item?.uuid,
            advancementId: getAdvancementId(child),
            role: normalizePoolRole(getAdvancementConfiguration(child).poolRole),
            parentPoolId: cleanPoolId(getAdvancementConfiguration(child).parentPoolId),
            poolSize: getAdvancementPool(child).length
          }))
        });

        for ( const child of actorChildren ) {
          const pool = getAdvancementPool(child);
          const key = `${child.item?.uuid ?? child.item?.id ?? "item"}.${getAdvancementId(child) ?? foundry.utils.randomID()}`;
          if ( seenPoolKeys.has(key) ) continue;
          seenPoolKeys.add(key);
          pools.push(pool);
        }

        for ( const item of actor.items ?? [] ) {
          const nestedPools = await collectMatchingChildPoolsFromItem(item, this.poolId, {
            currentAdvancement: this,
            seenPoolKeys,
            origin: `actor:${actor?.name ?? actor?.uuid ?? "unknown"}`
          });
          pools.push(...nestedPools);
        }
      }

      for ( const uuid of pendingUuids ) {
        const item = await fromUuid(uuid);
        if ( !item ) {
          debugChildSearch("pending uuid unresolved", { uuid });
          continue;
        }

        debugChildSearch("pending uuid resolved", {
          uuid,
          item: item.name,
          itemUuid: item.uuid,
          advancementCount: getItemAdvancements(item).length
        });

        const nestedPools = await collectMatchingChildPoolsFromItem(item, this.poolId, {
          currentAdvancement: this,
          seenPoolKeys,
          origin: uuid
        });
        pools.push(...nestedPools);
      }

      this._lgicPendingChildPools = pools;
      debugChildSearch("complete", {
        poolCount: pools.length,
        totalEntries: pools.reduce((total, pool) => total + (pool?.length ?? 0), 0),
        seenPoolKeys: Array.from(seenPoolKeys)
      });
      return pools;
    }

    configuredForLevel(level) {
      if ( this.isPoolChild ) return true;
      return super.configuredForLevel(level);
    }

    getLinkedChildAdvancements({ manager=null }={}) {
      if ( !this.isPoolParent || !this.poolId ) return [];

      const children = [];
      const seen = new Set();

      for ( const actor of getCandidateActors(this, manager) ) {
        for ( const child of getChildAdvancementsFromActor(actor, this.poolId, this) ) {
          const key = `${child.item?.uuid ?? child.item?.id ?? "item"}.${getAdvancementId(child) ?? foundry.utils.randomID()}`;
          if ( seen.has(key) ) continue;
          seen.add(key);
          children.push(child);
        }
      }

      return children;
    }

    getMergedPool({ manager=null }={}) {
      const maxLevel = getMaxSectionLevel();
      const pools = [this.configuration.pool ?? []];

      if ( this.isPoolParent ) {
        for ( const child of this.getLinkedChildAdvancements({ manager }) ) {
          pools.push(getAdvancementPool(child));
        }

        for ( const pendingPool of this._lgicPendingChildPools ?? [] ) {
          pools.push(pendingPool);
        }
      }

      return mergePools(pools, maxLevel);
    }

    getPoolForLevel(level, { manager=null }={}) {
      if ( this.isPoolChild ) return [];

      const numericLevel = Number(level);
      return this.getMergedPool({ manager }).filter(entry => {
        const min = Number(entry.minLevel ?? 0);
        return numericLevel >= min;
      });
    }

    isUuidAvailableAtLevel(uuid, level) {
      return this.getPoolForLevel(level).some(entry => entry.uuid === uuid);
    }

    async apply(level, data = {}, options = {}) {
      if ( this.isPoolChild ) return;

      if ( data.selected?.length ) await this.preparePendingChildPools();

      if ( data.selected?.length ) {
        const invalid = data.selected.filter(uuid => !this.isUuidAvailableAtLevel(uuid, level));
        if ( invalid.length ) {
          throw new this.constructor.ERROR(game.i18n.format("LGIC.Warning.InvalidSelection", { level }));
        }
      }

      const result = await super.apply(level, data, options);

      // A selected item that grants a child pool may not exist as an actor item yet; it can first live only
      // in an advancement value.added map. Reset the clone, then scan selected source UUIDs so the parent
      // pool can see child pools during the same advancement workflow.
      if ( data.selected?.length ) {
        this.actor?.reset?.();
        await this.preparePendingChildPools();
      }

      return result;
    }
  };
}
