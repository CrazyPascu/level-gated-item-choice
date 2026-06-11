const MODULE_ID = "level-gated-item-choice";
const ADVANCEMENT_TYPE = "LGICLevelGatedItemChoice";
const VALID_ITEM_TYPES = new Set(["background", "class", "feat", "race", "subclass"]);

let CLASSES = null;
let LAST_ERROR = null;

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

      return source;
    }
  }

  class LGICLevelGatedItemChoiceConfig extends ItemChoiceConfig {
    static get DEFAULT_OPTIONS() {
      const base = super.DEFAULT_OPTIONS ?? {};
      const classes = [...new Set([...(base.classes ?? []), "level-gated-item-choice"])];
      return foundry.utils.mergeObject(base, {
        classes,
        position: { width: 840 }
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

    async _prepareContext(options) {
      const context = await super._prepareContext(options);

      // New pool entries inherit the previous row's minimum level. This means a sequence
      // of 1, 1, 1, 1, 2 will make the next dropped item start at 2.
      let lastMin = 1;
      context.items = context.items.map(item => {
        const rawMin = item.data.minLevel;
        const min = [undefined, null, ""].includes(rawMin) ? lastMin : Number(rawMin);
        const minLevel = Number.isFinite(min) ? min : lastMin;
        lastMin = minLevel;

        return {
          ...item,
          minLevel
        };
      });

      return context;
    }

    async prepareConfigurationUpdate(configuration) {
      if ( configuration.pool ) {
        let lastMin = 1;
        configuration.pool = Object.values(configuration.pool).map(entry => {
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

      return super.prepareConfigurationUpdate(configuration);
    }
  }

  class LGICLevelGatedItemChoiceFlow extends ItemChoiceFlow {
    async _prepareContentContext(context, options) {
      this.pool = (
        await Promise.all(this.advancement.getPoolForLevel(this.level).map(entry => fromUuid(entry.uuid)))
      ).filter(Boolean);

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

    getPoolForLevel(level) {
      const numericLevel = Number(level);
      return this.configuration.pool.filter(entry => {
        const min = Number(entry.minLevel ?? 0);
        return numericLevel >= min;
      });
    }

    isUuidAvailableAtLevel(uuid, level) {
      return this.getPoolForLevel(level).some(entry => entry.uuid === uuid);
    }

    async apply(level, data = {}, options = {}) {
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
