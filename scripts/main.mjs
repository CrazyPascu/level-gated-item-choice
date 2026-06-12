const MODULE_ID = "level-gated-item-choice";
const ADVANCEMENT_TYPE = "LGICLevelGatedItemChoice";
const VALID_ITEM_TYPES = new Set(["background", "class", "feat", "race", "subclass"]);
const MAX_SECTION_LEVEL = 20;

function clampLevel(value, maxLevel = MAX_SECTION_LEVEL) {
  const numeric = Number(value);
  if ( !Number.isFinite(numeric) ) return 1;
  return Math.min(Math.max(Math.trunc(numeric), 1), maxLevel);
}

let CLASSES = null;
let LAST_ERROR = null;

function lgicSortItemsByName(items) {
  return items.sort((a, b) => {
    const nameA = String(a.item?.name ?? a.name ?? a.label ?? a.uuid ?? "");
    const nameB = String(b.item?.name ?? b.name ?? b.label ?? b.uuid ?? "");

    return nameB.localeCompare(nameA, game.i18n.lang, {
      sensitivity: "base",
      numeric: true
    });
  });
}

function lgicNormalizePoolRole(value) {
  return ["standalone", "parent", "child"].includes(value) ? value : "standalone";
}

function lgicCleanPoolId(value) {
  return String(value ?? "").trim();
}

function lgicCleanSectionTitle(value) {
  return String(value ?? "").trim();
}

function lgicGetSectionTitles(configuration) {
  const titles = configuration?.sectionTitles ?? {};
  return titles?.toObject?.() ?? titles;
}

function lgicGetSectionTitle(configuration, level, { flow=false, fallback=true }={}) {
  const title = lgicCleanSectionTitle(lgicGetSectionTitles(configuration)?.[level]);
  if ( title ) return title;
  if ( !fallback ) return "";
  return flow ? t("LGIC.Flow.AvailableFromLevel", { level }) : t("LGIC.Config.LevelLabel", { level });
}

function lgicGetSelectedSourceUuids(advancement) {
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

function lgicGetSelectedSourceUuidsFromActor(actor) {
  const uuids = new Set();

  for ( const item of actor?.items ?? [] ) {
    for ( const advancement of lgicGetItemAdvancements(item) ) {
      for ( const uuid of lgicGetSelectedSourceUuids(advancement) ) {
        uuids.add(uuid);
      }
    }
  }

  return Array.from(uuids);
}

function lgicGetSelectedSourceUuidsFromManager(manager) {
  const uuids = new Set();

  for ( const step of manager?.steps ?? [] ) {
    const advancement = step?.flow?.advancement;
    for ( const uuid of lgicGetSelectedSourceUuids(advancement) ) uuids.add(uuid);
  }

  return Array.from(uuids);
}


function lgicLooksLikeUuid(value) {
  if ( typeof value !== "string" ) return false;
  return /^(Actor|Item|Compendium|Scene|JournalEntry|Macro|RollTable)\./.test(value);
}

function lgicCollectUuidsDeep(value, { maxDepth=6, seen=new WeakSet() }={}) {
  const uuids = new Set();

  const collect = (entry, depth) => {
    if ( depth > maxDepth || entry == null ) return;

    if ( typeof entry === "string" ) {
      if ( lgicLooksLikeUuid(entry) ) uuids.add(entry);
      return;
    }

    if ( typeof entry !== "object" ) return;
    if ( seen.has(entry) ) return;
    seen.add(entry);

    if ( lgicLooksLikeUuid(entry.uuid) ) uuids.add(entry.uuid);

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

function lgicDebugChildSearch(message, data = {}) {
  console.log(`${MODULE_ID} | child pool scan | ${message}`, data);
}

function lgicGetCandidateActors(advancement, manager) {
  const actors = [];
  if ( advancement?.actor ) actors.push(advancement.actor);
  if ( manager?.clone && !actors.includes(manager.clone) ) actors.push(manager.clone);
  return actors;
}

function lgicGetChildAdvancementsFromActor(actor, parentPoolId, currentAdvancement) {
  if ( !actor || !parentPoolId ) return [];

  const children = [];
  const currentId = lgicGetAdvancementId(currentAdvancement);

  for ( const item of actor.items ?? [] ) {
    for ( const advancement of lgicGetItemAdvancements(item) ) {
      if ( lgicGetAdvancementType(advancement) !== ADVANCEMENT_TYPE ) continue;
      if ( lgicGetAdvancementId(advancement) === currentId ) continue;

      const configuration = lgicGetAdvancementConfiguration(advancement);
      if ( lgicNormalizePoolRole(configuration.poolRole) !== "child" ) continue;
      if ( lgicCleanPoolId(configuration.parentPoolId) !== parentPoolId ) continue;

      children.push(advancement);
    }
  }

  return children;
}

function lgicGetAdvancementId(advancement) {
  return advancement?.id ?? advancement?._id ?? advancement?.data?._id ?? advancement?.toObject?.()?._id ?? null;
}

function lgicGetAdvancementType(advancement) {
  return advancement?.type ?? advancement?.constructor?.typeName ?? advancement?.data?.type ?? advancement?.toObject?.()?.type ?? null;
}

function lgicGetAdvancementConfiguration(advancement) {
  return advancement?.configuration ?? advancement?.data?.configuration ?? advancement?.toObject?.()?.configuration ?? {};
}

function lgicGetAdvancementPool(advancement) {
  const pool = lgicGetAdvancementConfiguration(advancement).pool ?? [];
  return Array.isArray(pool) ? pool : Object.values(pool);
}

function lgicGetItemAdvancements(item) {
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

function lgicCollectGrantEntryUuids(entries) {
  const uuids = new Set();
  const collect = entry => {
    if ( !entry ) return;
    if ( typeof entry === "string" ) {
      if ( lgicLooksLikeUuid(entry) ) uuids.add(entry);
      return;
    }
    if ( Array.isArray(entry) ) {
      for ( const value of entry ) collect(value);
      return;
    }
    if ( typeof entry !== "object" ) return;
    if ( lgicLooksLikeUuid(entry.uuid) ) uuids.add(entry.uuid);
  };

  collect(entries);
  return Array.from(uuids);
}

function lgicGetFollowUpItemUuidsFromAdvancement(advancement) {
  const configuration = lgicGetAdvancementConfiguration(advancement);
  const type = lgicGetAdvancementType(advancement);
  const uuids = new Set();

  // Actual selections already stored by an advancement.
  for ( const uuid of lgicGetSelectedSourceUuids(advancement) ) uuids.add(uuid);

  // dnd5e Item Grant advancements store granted item UUIDs in configuration.items.
  // This is the important path for nested chains like B grants C grants D.
  for ( const uuid of lgicCollectGrantEntryUuids(configuration.items) ) uuids.add(uuid);

  // For non-LGIC Item Choice advancements, optionally follow the possible pool entries too.
  // Do not follow this module's own configuration.pool here, because that pool means
  // "choices contributed to the parent", not necessarily "items granted by this source item".
  if ( type !== ADVANCEMENT_TYPE ) {
    for ( const uuid of lgicCollectGrantEntryUuids(configuration.pool) ) uuids.add(uuid);
  }

  return Array.from(uuids);
}

async function lgicCollectMatchingChildPoolsFromItem(item, parentPoolId, {
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

  const currentId = lgicGetAdvancementId(currentAdvancement);
  const advancements = lgicGetItemAdvancements(item);

  lgicDebugChildSearch("recursive item scan", {
    origin,
    depth,
    item: item.name,
    itemUuid: item.uuid,
    advancementCount: advancements.length
  });

  const nextUuids = new Set();

  for ( const advancement of advancements ) {
    const configuration = lgicGetAdvancementConfiguration(advancement);
    const type = lgicGetAdvancementType(advancement);
    const role = lgicNormalizePoolRole(configuration.poolRole);
    const childParentPoolId = lgicCleanPoolId(configuration.parentPoolId);
    const advancementId = lgicGetAdvancementId(advancement);
    const pool = lgicGetAdvancementPool(advancement);
    const followUpUuids = lgicGetFollowUpItemUuidsFromAdvancement(advancement);

    lgicDebugChildSearch("recursive advancement inspected", {
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
          lgicDebugChildSearch("recursive child pool added", {
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
      lgicDebugChildSearch("recursive follow-up unresolved", { origin, depth, uuid });
      continue;
    }

    const nestedPools = await lgicCollectMatchingChildPoolsFromItem(nextItem, parentPoolId, {
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

function lgicNormalizePoolEntry(entry, maxLevel = MAX_SECTION_LEVEL) {
  if ( !entry?.uuid ) return null;

  const rawMin = entry.minLevel;
  const min = [undefined, null, ""].includes(rawMin) ? 1 : Number(rawMin);

  return {
    uuid: entry.uuid,
    minLevel: clampLevel(Number.isFinite(min) ? min : 1, maxLevel)
  };
}

function lgicMergePools(pools, maxLevel = MAX_SECTION_LEVEL) {
  const merged = new Map();

  for ( const pool of pools ) {
    for ( const rawEntry of pool ?? [] ) {
      const entry = lgicNormalizePoolEntry(rawEntry, maxLevel);
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


function t(key, data = {}) {
  const i18n = game?.i18n;
  if ( !i18n ) return key;
  return Object.keys(data).length ? i18n.format(key, data) : i18n.localize(key);
}

function log(message, ...args) {
  console.log(`${MODULE_ID} | ${message}`, ...args);
}

function warn(message, ...args) {
  console.warn(`${MODULE_ID} | ${message}`, ...args);
}

function getNamespace() {
  return game?.dnd5e ?? globalThis.dnd5e ?? null;
}

function getRegistry() {
  return CONFIG?.DND5E?.advancementTypes
    ?? getNamespace()?.config?.advancementTypes
    ?? null;
}

function getDnd5eParts() {
  const dnd5e = getNamespace();
  if ( !dnd5e ) throw new Error("The dnd5e namespace is not available yet.");

  const ItemChoiceAdvancement = dnd5e.documents?.advancement?.ItemChoiceAdvancement;
  const ItemChoiceConfig = dnd5e.applications?.advancement?.ItemChoiceConfig;
  const ItemChoiceFlow = dnd5e.applications?.advancement?.ItemChoiceFlow;
  const ItemChoiceConfigurationData = dnd5e.dataModels?.advancement?.ItemChoiceConfigurationData;
  const ItemChoiceValueData = dnd5e.dataModels?.advancement?.ItemChoiceValueData;

  const missing = [];
  if ( !ItemChoiceAdvancement ) missing.push("dnd5e.documents.advancement.ItemChoiceAdvancement");
  if ( !ItemChoiceConfig ) missing.push("dnd5e.applications.advancement.ItemChoiceConfig");
  if ( !ItemChoiceFlow ) missing.push("dnd5e.applications.advancement.ItemChoiceFlow");
  if ( !ItemChoiceConfigurationData ) missing.push("dnd5e.dataModels.advancement.ItemChoiceConfigurationData");
  if ( !ItemChoiceValueData ) missing.push("dnd5e.dataModels.advancement.ItemChoiceValueData");

  if ( missing.length ) throw new Error(`Missing dnd5e API parts: ${missing.join(", ")}`);
  return { ItemChoiceAdvancement, ItemChoiceConfig, ItemChoiceFlow, ItemChoiceConfigurationData, ItemChoiceValueData };
}

function buildClasses() {
  if ( CLASSES ) return CLASSES;

  const {
    ItemChoiceAdvancement,
    ItemChoiceConfig,
    ItemChoiceFlow,
    ItemChoiceConfigurationData,
    ItemChoiceValueData
  } = getDnd5eParts();

  const { ArrayField, NumberField, SchemaField, StringField } = foundry.data.fields;

  class LGICLevelGatedItemChoiceConfigurationData extends ItemChoiceConfigurationData {
    static LOCALIZATION_PREFIXES = [
      "LGIC.Advancement",
      ...(ItemChoiceConfigurationData.LOCALIZATION_PREFIXES ?? [])
    ];

    static defineSchema() {
      const schema = super.defineSchema();
      schema.pool = new ArrayField(new SchemaField({
        uuid: new StringField({ required: true, nullable: false, blank: false }),
        minLevel: new NumberField({
          required: false,
          integer: true,
          min: 0,
          nullable: true,
          initial: null,
          label: "LGIC.Config.MinLevel"
        })
      }));

      schema.poolRole = new StringField({
        required: false,
        nullable: false,
        blank: false,
        initial: "standalone",
        label: "LGIC.Config.PoolRole"
      });

      schema.poolId = new StringField({
        required: false,
        nullable: false,
        blank: true,
        initial: "",
        label: "LGIC.Config.PoolId"
      });

      schema.parentPoolId = new StringField({
        required: false,
        nullable: false,
        blank: true,
        initial: "",
        label: "LGIC.Config.ParentPoolId"
      });

      schema.sectionTitles = new SchemaField(Object.fromEntries(
        Array.from({ length: MAX_SECTION_LEVEL }, (_, index) => {
          const level = index + 1;
          return [level, new StringField({
            required: false,
            nullable: false,
            blank: true,
            initial: "",
            label: "LGIC.Config.SectionTitle"
          })];
        })
      ), {
        required: false,
        nullable: false,
        label: "LGIC.Config.SectionTitles"
      });

      return schema;
    }

    static migrateData(source) {
      source = super.migrateData(source) ?? source;
      const pool = Array.isArray(source.pool) ? source.pool : Object.values(source.pool ?? {});

      if ( pool.length ) {
        let lastMin = 1;
        source.pool = pool.map(entry => {
          if ( foundry.utils.getType(entry) === "string" ) return { uuid: entry, minLevel: lastMin };

          const rawMin = entry.minLevel;
          const min = [undefined, null, ""].includes(rawMin) ? lastMin : Number(rawMin);
          const minLevel = Number.isFinite(min) ? min : lastMin;
          lastMin = minLevel;

          return {
            uuid: entry.uuid,
            minLevel
          };
        });
      }

      source.poolRole = lgicNormalizePoolRole(source.poolRole);
      source.poolId = lgicCleanPoolId(source.poolId);
      source.parentPoolId = lgicCleanPoolId(source.parentPoolId);

      const sectionTitles = source.sectionTitles ?? {};
      source.sectionTitles = Object.fromEntries(
        Array.from({ length: MAX_SECTION_LEVEL }, (_, index) => {
          const level = index + 1;
          return [level, lgicCleanSectionTitle(sectionTitles[level])];
        })
      );

      return source;
    }
  }

  class LGICLevelGatedItemChoiceConfig extends ItemChoiceConfig {
    static get DEFAULT_OPTIONS() {
      const base = super.DEFAULT_OPTIONS ?? {};
      const classes = [...new Set([...(base.classes ?? []), "level-gated-item-choice"])] ;
      return foundry.utils.mergeObject(base, {
        classes,
        position: { width: 980 }
      }, { inplace: false });
    }

    static get PARTS() {
      return foundry.utils.mergeObject(super.PARTS ?? {}, {
        items: {
          container: { classes: ["column-container"], id: "column-center" },
          template: `modules/${MODULE_ID}/templates/level-gated-item-choice-config-items.hbs`
        }
      }, { inplace: false });
    }

    get collapseStorageKey() {
      const itemKey = this.item?.uuid ?? this.item?.id ?? "item";
      const advancementKey = this.advancement?.id ?? this.advancement?._id ?? "advancement";
      return `${MODULE_ID}.collapsed-levels.${itemKey}.${advancementKey}`;
    }

    loadCollapsedLevels() {
      if ( this._collapsedLevels instanceof Set ) return this._collapsedLevels;
      try {
        const stored = JSON.parse(localStorage.getItem(this.collapseStorageKey) ?? "[]");
        this._collapsedLevels = new Set(Array.isArray(stored) ? stored.map(String) : []);
      } catch(err) {
        this._collapsedLevels = new Set();
      }
      return this._collapsedLevels;
    }

    saveCollapsedLevels() {
      if ( !(this._collapsedLevels instanceof Set) ) return;
      localStorage.setItem(this.collapseStorageKey, JSON.stringify(Array.from(this._collapsedLevels)));
    }

    setLevelCollapsed(level, collapsed) {
      const collapsedLevels = this.loadCollapsedLevels();
      const key = String(level);
      if ( collapsed ) collapsedLevels.add(key);
      else collapsedLevels.delete(key);
      this.saveCollapsedLevels();
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const maxLevel = Math.min(Number(CONFIG.DND5E?.maxLevel ?? MAX_SECTION_LEVEL), MAX_SECTION_LEVEL) || MAX_SECTION_LEVEL;
      const collapsedLevels = this.loadCollapsedLevels();
      const sections = new Map();

      for ( let level = 1; level <= maxLevel; level++ ) {
        const defaultLabel = t("LGIC.Config.LevelLabel", { level });
        const titleValue = lgicGetSectionTitle(this.advancement.configuration, level, { fallback: false });

        sections.set(level, {
          level,
          label: titleValue || defaultLabel,
          defaultLabel,
          titleValue,
          dropLabel: t("LGIC.Config.DropHere", { level }),
          open: !collapsedLevels.has(String(level)),
          items: []
        });
      }

      context.items = (context.items ?? []).map((item, index) => {
        const rawMin = item.data?.minLevel;
        const min = [undefined, null, ""].includes(rawMin) ? 1 : Number(rawMin);
        const minLevel = clampLevel(Number.isFinite(min) ? min : 1, maxLevel);

        return {
          ...item,
          poolIndex: index,
          minLevel
        };
      });

      for ( const item of context.items ) {
        sections.get(item.minLevel)?.items.push(item);
      }

      context.levelSections = Array.from(sections.values());

      for ( const section of context.levelSections ) {
        lgicSortItemsByName(section.items);
      }

      const poolRole = lgicNormalizePoolRole(this.advancement.configuration.poolRole);
      context.poolRole = poolRole;
      context.isPoolParent = poolRole === "parent";
      context.isPoolChild = poolRole === "child";
      context.poolId = this.advancement.configuration.poolId ?? "";
      context.parentPoolId = this.advancement.configuration.parentPoolId ?? "";
      context.poolRoleOptions = [
        { value: "standalone", label: t("LGIC.Config.PoolRoleStandalone"), selected: poolRole === "standalone" },
        { value: "parent", label: t("LGIC.Config.PoolRoleParent"), selected: poolRole === "parent" },
        { value: "child", label: t("LGIC.Config.PoolRoleChild"), selected: poolRole === "child" }
      ];

      return context;
    }

    async prepareConfigurationUpdate(configuration) {
      if ( configuration.pool ) {
        const maxLevel = Math.min(Number(CONFIG.DND5E?.maxLevel ?? MAX_SECTION_LEVEL), MAX_SECTION_LEVEL) || MAX_SECTION_LEVEL;
        configuration.pool = Object.values(configuration.pool).map(entry => {
          const rawMin = entry.minLevel;
          const min = [undefined, null, ""].includes(rawMin) ? 1 : Number(rawMin);
          const minLevel = clampLevel(Number.isFinite(min) ? min : 1, maxLevel);

          return {
            uuid: entry.uuid,
            minLevel
          };
        });
      }

      configuration.poolRole = lgicNormalizePoolRole(configuration.poolRole);
      configuration.poolId = lgicCleanPoolId(configuration.poolId);
      configuration.parentPoolId = lgicCleanPoolId(configuration.parentPoolId);

      if ( configuration.poolRole !== "parent" ) configuration.poolId = "";
      if ( configuration.poolRole !== "child" ) configuration.parentPoolId = "";

      const sectionTitles = configuration.sectionTitles ?? {};
      configuration.sectionTitles = Object.fromEntries(
        Array.from({ length: MAX_SECTION_LEVEL }, (_, index) => {
          const level = index + 1;
          return [level, lgicCleanSectionTitle(sectionTitles[level])];
        })
      );

      return super.prepareConfigurationUpdate(configuration);
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      if ( !this.isEditable ) return;

      for ( const zone of this.element.querySelectorAll("[data-lgic-level]") ) {
        zone.addEventListener("toggle", () => {
          this.setLevelCollapsed(zone.dataset.lgicLevel, !zone.open);
        });

        zone.addEventListener("dragenter", () => zone.classList.add("lgic-drop-active"));
        zone.addEventListener("dragover", event => {
          event.preventDefault();
          zone.classList.add("lgic-drop-active");
        });
        zone.addEventListener("dragleave", event => {
          if ( !zone.contains(event.relatedTarget) ) zone.classList.remove("lgic-drop-active");
        });
        zone.addEventListener("drop", () => zone.classList.remove("lgic-drop-active"));
      }

      for ( const input of this.element.querySelectorAll("[data-lgic-section-title]") ) {
        input.addEventListener("click", event => event.stopPropagation());
        input.addEventListener("pointerdown", event => event.stopPropagation());
        input.addEventListener("keydown", event => event.stopPropagation());
      }

      const roleSelect = this.element.querySelector("[data-lgic-pool-role]");
      const updateRoleFields = () => {
        const role = lgicNormalizePoolRole(roleSelect?.value);
        for ( const field of this.element.querySelectorAll("[data-lgic-role-field]") ) {
          const visible = field.dataset.lgicRoleField === role;
          field.classList.toggle("lgic-hidden", !visible);
        }
      };
      roleSelect?.addEventListener("change", updateRoleFields);
      updateRoleFields();
    }

    async _onDragStart(event) {
      const row = event.target.closest?.("[data-item-uuid]");
      const uuid = row?.dataset.itemUuid;
      if ( !uuid ) return;

      event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      event.dataTransfer.effectAllowed = "move";
    }

    async _onDrop(event) {
      const levelSection = event.target.closest?.("[data-lgic-level]");
      if ( !levelSection ) {
        ui.notifications.warn(t("LGIC.Warning.DropOnLevel"));
        return;
      }

      const minLevel = Number(levelSection.dataset.lgicLevel);
      if ( !Number.isFinite(minLevel) ) return;

      if ( "open" in levelSection ) {
        levelSection.open = true;
        this.setLevelCollapsed(minLevel, false);
      }

      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if ( data?.type !== "Item" ) return;

      const item = await Item.implementation.fromDropData(data);
      try {
        this._validateDroppedItem(event, item);
      } catch(err) {
        ui.notifications.error(err.message);
        return;
      }

      if ( item.uuid === this.item.uuid ) {
        ui.notifications.error("DND5E.ADVANCEMENT.ItemGrant.Warning.Recursive", { localize: true });
        return;
      }

      const existingItems = foundry.utils.deepClone(this.advancement.configuration.pool ?? []);
      const existingIndex = existingItems.findIndex(entry => entry.uuid === item.uuid);

      if ( existingIndex >= 0 ) {
        existingItems[existingIndex].minLevel = minLevel;
        ui.notifications.info(t("LGIC.Notification.Moved", { name: item.name, level: minLevel }));
      } else {
        existingItems.push({ uuid: item.uuid, minLevel });
      }

      await this.submit({ updateData: { "configuration.pool": existingItems } });
    }
  }

  class LGICLevelGatedItemChoiceFlow extends ItemChoiceFlow {
    static get DEFAULT_OPTIONS() {
      const base = super.DEFAULT_OPTIONS ?? {};
      const classes = [...new Set([...(base.classes ?? []), "level-gated-item-choice", "lgic-choice-flow"])] ;
      return foundry.utils.mergeObject(base, { classes }, { inplace: false });
    }


    async _prepareContentContext(context, options) {
      this.manager?.clone?.reset?.();
      this.advancement.actor?.reset?.();
      await this.advancement.preparePendingChildPools?.({ manager: this.manager });

      if ( this.advancement.isPoolChild ) {
        this.pool = [];
      } else {
        this.pool = (
          await Promise.all(this.advancement.getPoolForLevel(this.level, { manager: this.manager }).map(entry => fromUuid(entry.uuid)))
        ).filter(Boolean);
      }

      context = await super._prepareContentContext(context, options);

      // The core browser cannot enforce this module's per-pool-entry level gates.
      context.showBrowseButton = false;
      this._prepareLevelChoiceSections(context);
      return context;
    }

    _prepareLevelChoiceSections(context) {
      const sections = Array.from(context.sections ?? []);
      const maxLevel = Math.min(Number(CONFIG.DND5E?.maxLevel ?? MAX_SECTION_LEVEL), MAX_SECTION_LEVEL) || MAX_SECTION_LEVEL;
      const entryLevels = new Map();
      const mergedPool = this.advancement.getMergedPool?.({ manager: this.manager }) ?? this.advancement.getPoolForLevel(this.level, { manager: this.manager });

      for ( const entry of mergedPool ) {
        const minLevel = clampLevel(entry.minLevel ?? 1, maxLevel);
        entryLevels.set(entry.uuid, minLevel);
      }

      for ( const item of this.pool ?? [] ) {
        const sourceUuid = item.flags?.dnd5e?.sourceId ?? item.uuid;
        const entry = mergedPool.find(e => (e.uuid === sourceUuid) || (e.uuid === item.uuid));
        if ( !entry ) continue;

        const minLevel = clampLevel(entry.minLevel ?? 1, maxLevel);
        entryLevels.set(sourceUuid, minLevel);
        entryLevels.set(item.uuid, minLevel);
      }

      const levelForItem = item => {
        const uuid = item?.uuid;
        if ( entryLevels.has(uuid) ) return entryLevels.get(uuid);

        const actorItem = item?.id ? this.advancement.actor?.items?.get(item.id) : null;
        const sourceUuid = actorItem?.flags?.dnd5e?.sourceId ?? actorItem?._stats?.compendiumSource ?? actorItem?.uuid;
        if ( entryLevels.has(sourceUuid) ) return entryLevels.get(sourceUuid);

        return clampLevel(this.level ?? 1, maxLevel);
      };

      const rebuiltSections = [];

      for ( const section of sections ) {
        const grouped = new Map();

        for ( const item of section.items ?? [] ) {
          const minLevel = levelForItem(item);
          if ( !grouped.has(minLevel) ) {
            grouped.set(minLevel, {
              ...section,
              level: minLevel,
              header: this.advancement.getRegionTitle(minLevel, { flow: true }),
              items: []
            });
          }

          grouped.get(minLevel).items.push(item);
        }

        const levelSections = Array.from(grouped.values()).sort((a, b) => a.level - b.level);
        for ( const levelSection of levelSections ) {
          lgicSortItemsByName(levelSection.items);
          rebuiltSections.push(levelSection);
        }
      }

      context.sections = rebuiltSections;
    }

    async _handleForm(event, form, formData) {
      const target = event.target;
      const isChoiceCheckbox = target?.tagName === "DND5E-CHECKBOX";

      await super._handleForm(event, form, formData);

      if ( isChoiceCheckbox ) {
        // A selected item may grant a child pool. Clear the cached pool and re-render so the
        // parent pool can immediately include child entries added to the advancement actor clone.
        this.pool = null;
        this.manager?.clone?.reset?.();
        this.advancement.actor?.reset?.();
        await this.advancement.preparePendingChildPools?.({
          manager: this.manager,
          extraUuids: target.checked ? [target.name] : []
        });
        this.render();
      }
    }

    async _onDrop(event) {
      if ( this.counts.full ) return false;

      let data;
      try {
        data = JSON.parse(event.dataTransfer.getData("text/plain"));
      } catch(err) {
        return false;
      }

      if ( data.type !== "Item" ) return false;
      const item = await Item.implementation.fromDropData(data);

      try {
        this.advancement._validateItemType(item);
      } catch(err) {
        ui.notifications.error(err.message);
        return null;
      }

      const sourceUuid = item.flags.dnd5e?.sourceId ?? item.uuid;
      const poolEntry = this.advancement.getPoolForLevel(this.level, { manager: this.manager }).find(entry => {
        return (entry.uuid === item.uuid) || (entry.uuid === sourceUuid);
      });

      if ( !poolEntry ) {
        ui.notifications.error(t("LGIC.Warning.Unavailable", { name: item.name, level: this.level }));
        return null;
      }

      const spellLevel = this.advancement.configuration.restriction.level;
      if ( (this.advancement.configuration.type === "spell") && (spellLevel === "available") ) {
        const maxSlot = this._maxSpellSlotLevel();
        if ( item.system.level > maxSlot ) {
          ui.notifications.error(game.i18n.format("DND5E.ADVANCEMENT.ItemChoice.Warning.SpellLevelAvailable", {
            level: CONFIG.DND5E.spellLevels[maxSlot]
          }));
          return null;
        }
      }

      await this.advancement.apply(this.level, { selected: [poolEntry.uuid] });
      this.pool = null;
      this.manager?.clone?.reset?.();
      this.advancement.actor?.reset?.();
      await this.advancement.preparePendingChildPools?.({
        manager: this.manager,
        extraUuids: [poolEntry.uuid]
      });
      this.render();
    }
  }

  class LGICLevelGatedItemChoiceAdvancement extends ItemChoiceAdvancement {
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
      return lgicNormalizePoolRole(this.configuration.poolRole);
    }

    get isPoolParent() {
      return this.poolRole === "parent";
    }

    get isPoolChild() {
      return this.poolRole === "child";
    }

    get poolId() {
      return lgicCleanPoolId(this.configuration.poolId);
    }

    get parentPoolId() {
      return lgicCleanPoolId(this.configuration.parentPoolId);
    }

    get levels() {
      if ( this.isPoolChild ) return [];
      return super.levels;
    }

    getRegionTitle(level, { flow=false }={}) {
      return lgicGetSectionTitle(this.configuration, level, { flow, fallback: true });
    }

    async preparePendingChildPools({ manager=null, extraUuids=[] }={}) {
      this._lgicPendingChildPools = [];
      if ( !this.isPoolParent || !this.poolId ) {
        lgicDebugChildSearch("skipped", {
          reason: !this.isPoolParent ? "not-parent" : "missing-pool-id",
          item: this.item?.name,
          advancementId: lgicGetAdvancementId(this)
        });
        return [];
      }

      manager?.clone?.reset?.();
      this.actor?.reset?.();

      const pools = [];
      const seenPoolKeys = new Set();
      const currentSelectionUuids = lgicGetSelectedSourceUuids(this);
      const managerSelectionUuids = lgicGetSelectedSourceUuidsFromManager(manager);
      const deepManagerUuids = lgicCollectUuidsDeep(manager, { maxDepth: 6 });
      const pendingUuids = new Set([
        ...currentSelectionUuids,
        ...managerSelectionUuids,
        ...deepManagerUuids,
        ...extraUuids
      ]);

      lgicDebugChildSearch("start", {
        parentItem: this.item?.name,
        parentPoolId: this.poolId,
        advancementId: lgicGetAdvancementId(this),
        managerSteps: manager?.steps?.length ?? null,
        currentSelectionUuids,
        managerSelectionUuids,
        deepManagerUuids,
        extraUuids,
        pendingUuids: Array.from(pendingUuids)
      });

      const actors = lgicGetCandidateActors(this, manager);
      lgicDebugChildSearch("candidate actors", actors.map(actor => ({
        name: actor?.name,
        id: actor?.id,
        uuid: actor?.uuid,
        itemCount: actor?.items?.size ?? actor?.items?.length ?? 0
      })));

      for ( const actor of actors ) {
        for ( const uuid of lgicGetSelectedSourceUuidsFromActor(actor) ) pendingUuids.add(uuid);

        const actorChildren = lgicGetChildAdvancementsFromActor(actor, this.poolId, this);
        lgicDebugChildSearch("actor children found", {
          actor: actor?.name,
          count: actorChildren.length,
          children: actorChildren.map(child => ({
            item: child.item?.name,
            itemUuid: child.item?.uuid,
            advancementId: lgicGetAdvancementId(child),
            role: lgicNormalizePoolRole(lgicGetAdvancementConfiguration(child).poolRole),
            parentPoolId: lgicCleanPoolId(lgicGetAdvancementConfiguration(child).parentPoolId),
            poolSize: lgicGetAdvancementPool(child).length
          }))
        });

        for ( const child of actorChildren ) {
          const pool = lgicGetAdvancementPool(child);
          const key = `${child.item?.uuid ?? child.item?.id ?? "item"}.${lgicGetAdvancementId(child) ?? foundry.utils.randomID()}`;
          if ( seenPoolKeys.has(key) ) continue;
          seenPoolKeys.add(key);
          pools.push(pool);
        }

        for ( const item of actor.items ?? [] ) {
          const nestedPools = await lgicCollectMatchingChildPoolsFromItem(item, this.poolId, {
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
          lgicDebugChildSearch("pending uuid unresolved", { uuid });
          continue;
        }

        lgicDebugChildSearch("pending uuid resolved", {
          uuid,
          item: item.name,
          itemUuid: item.uuid,
          advancementCount: lgicGetItemAdvancements(item).length
        });

        const nestedPools = await lgicCollectMatchingChildPoolsFromItem(item, this.poolId, {
          currentAdvancement: this,
          seenPoolKeys,
          origin: uuid
        });
        pools.push(...nestedPools);
      }

      this._lgicPendingChildPools = pools;
      lgicDebugChildSearch("complete", {
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

      for ( const actor of lgicGetCandidateActors(this, manager) ) {
        for ( const child of lgicGetChildAdvancementsFromActor(actor, this.poolId, this) ) {
          const key = `${child.item?.uuid ?? child.item?.id ?? "item"}.${lgicGetAdvancementId(child) ?? foundry.utils.randomID()}`;
          if ( seen.has(key) ) continue;
          seen.add(key);
          children.push(child);
        }
      }

      return children;
    }


    getMergedPool({ manager=null }={}) {
      const maxLevel = Math.min(Number(CONFIG.DND5E?.maxLevel ?? MAX_SECTION_LEVEL), MAX_SECTION_LEVEL) || MAX_SECTION_LEVEL;
      const pools = [this.configuration.pool ?? []];

      if ( this.isPoolParent ) {
        for ( const child of this.getLinkedChildAdvancements({ manager }) ) {
          pools.push(lgicGetAdvancementPool(child));
        }

        for ( const pendingPool of this._lgicPendingChildPools ?? [] ) {
          pools.push(pendingPool);
        }
      }

      return lgicMergePools(pools, maxLevel);
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
  }

  CLASSES = {
    LGICLevelGatedItemChoiceAdvancement,
    LGICLevelGatedItemChoiceConfig,
    LGICLevelGatedItemChoiceFlow,
    LGICLevelGatedItemChoiceConfigurationData
  };

  return CLASSES;
}

function registerAdvancementType(phase = "unknown") {
  try {
    if ( game.system?.id !== "dnd5e" ) {
      LAST_ERROR = new Error(`The active system is ${game.system?.id ?? "unknown"}, not dnd5e.`);
      return false;
    }

    const registry = getRegistry();
    if ( !registry ) {
      LAST_ERROR = new Error("CONFIG.DND5E.advancementTypes is not available yet.");
      return false;
    }

    const classes = buildClasses();
    registry[ADVANCEMENT_TYPE] = {
      documentClass: classes.LGICLevelGatedItemChoiceAdvancement,
      validItemTypes: VALID_ITEM_TYPES
    };

    const module = game.modules.get(MODULE_ID);
    if ( module ) {
      module.api = {
        ADVANCEMENT_TYPE,
        VALID_ITEM_TYPES,
        registerAdvancementType,
        ...classes
      };
    }

    LAST_ERROR = null;
    log(`registered ${ADVANCEMENT_TYPE} during ${phase}`);
    return true;
  } catch(err) {
    LAST_ERROR = err;
    warn(`registration failed during ${phase}`, err);
    return false;
  }
}

Hooks.once("init", () => registerAdvancementType("init"));
Hooks.once("setup", () => registerAdvancementType("setup"));

Hooks.once("i18nInit", () => {
  if ( registerAdvancementType("i18nInit") ) {
    CLASSES?.LGICLevelGatedItemChoiceAdvancement?.localize?.();
  }
});

Hooks.once("ready", () => {
  const ok = registerAdvancementType("ready");
  if ( ok ) {
    ui.notifications?.info?.(t("LGIC.Notification.Registered"));
    return;
  }

  ui.notifications?.error?.(t("LGIC.Notification.NotRegistered"));
  if ( LAST_ERROR ) warn("last registration error", LAST_ERROR);
});
