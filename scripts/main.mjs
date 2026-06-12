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
  const advancements = item?.system?.advancement;
  if ( !advancements ) return [];

  if ( Array.isArray(advancements) ) return advancements;
  if ( typeof advancements.values === "function" ) return Array.from(advancements.values());

  return Object.values(advancements);
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
        sections.set(level, {
          level,
          label: t("LGIC.Config.LevelLabel", { level }),
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
    async _prepareContentContext(context, options) {
      if ( this.advancement.isPoolChild ) {
        this.pool = [];
      } else {
        this.pool = (
          await Promise.all(this.advancement.getPoolForLevel(this.level).map(entry => fromUuid(entry.uuid)))
        ).filter(Boolean);
      }

      context = await super._prepareContentContext(context, options);

      // The core browser cannot enforce this module's per-pool-entry level gates.
      context.showBrowseButton = false;
      return context;
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
      const poolEntry = this.advancement.getPoolForLevel(this.level).find(entry => {
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

    configuredForLevel(level) {
      if ( this.isPoolChild ) return true;
      return super.configuredForLevel(level);
    }

    getLinkedChildAdvancements() {
      if ( !this.isPoolParent || !this.poolId || !this.actor ) return [];

      const children = [];
      const currentId = lgicGetAdvancementId(this);

      for ( const item of this.actor.items ?? [] ) {
        for ( const advancement of lgicGetItemAdvancements(item) ) {
          if ( lgicGetAdvancementType(advancement) !== ADVANCEMENT_TYPE ) continue;
          if ( lgicGetAdvancementId(advancement) === currentId ) continue;

          const configuration = lgicGetAdvancementConfiguration(advancement);
          if ( lgicNormalizePoolRole(configuration.poolRole) !== "child" ) continue;
          if ( lgicCleanPoolId(configuration.parentPoolId) !== this.poolId ) continue;

          children.push(advancement);
        }
      }

      return children;
    }

    getMergedPool() {
      const maxLevel = Math.min(Number(CONFIG.DND5E?.maxLevel ?? MAX_SECTION_LEVEL), MAX_SECTION_LEVEL) || MAX_SECTION_LEVEL;
      const pools = [this.configuration.pool ?? []];

      if ( this.isPoolParent ) {
        for ( const child of this.getLinkedChildAdvancements() ) {
          pools.push(lgicGetAdvancementPool(child));
        }
      }

      return lgicMergePools(pools, maxLevel);
    }

    getPoolForLevel(level) {
      if ( this.isPoolChild ) return [];

      const numericLevel = Number(level);
      return this.getMergedPool().filter(entry => {
        const min = Number(entry.minLevel ?? 0);
        return numericLevel >= min;
      });
    }

    isUuidAvailableAtLevel(uuid, level) {
      return this.getPoolForLevel(level).some(entry => entry.uuid === uuid);
    }

    async apply(level, data = {}, options = {}) {
      if ( this.isPoolChild ) return;

      if ( data.selected?.length ) {
        const invalid = data.selected.filter(uuid => !this.isUuidAvailableAtLevel(uuid, level));
        if ( invalid.length ) {
          throw new this.constructor.ERROR(game.i18n.format("LGIC.Warning.InvalidSelection", { level }));
        }
      }

      return super.apply(level, data, options);
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
