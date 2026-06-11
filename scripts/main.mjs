import ItemChoiceAdvancement from "/systems/dnd5e/module/documents/advancement/item-choice.mjs";
import ItemChoiceConfig from "/systems/dnd5e/module/applications/advancement/item-choice-config.mjs";
import ItemChoiceFlow from "/systems/dnd5e/module/applications/advancement/item-choice-flow.mjs";
import {
  ItemChoiceConfigurationData,
  ItemChoiceValueData
} from "/systems/dnd5e/module/data/advancement/item-choice.mjs";

const MODULE_ID = "level-gated-item-choice";

// Namespaced type key. This must match the advancement class name without the "Advancement" suffix.
const ADVANCEMENT_TYPE = "LGICLevelGatedItemChoice";
const VALID_ITEM_TYPES = new Set(["race", "background", "class", "subclass", "feat"]);

const {
  ArrayField,
  NumberField,
  SchemaField,
  StringField
} = foundry.data.fields;

/**
 * Item Choice configuration with per-pool-entry level gates.
 *
 * Each pool entry is:
 *   { uuid: string, minLevel: number, maxLevel: number|null }
 *
 * minLevel is inclusive. maxLevel is inclusive. Null maxLevel means "no upper limit".
 */
class LGICLevelGatedItemChoiceConfigurationData extends ItemChoiceConfigurationData {
  static LOCALIZATION_PREFIXES = [
    "LGIC.Advancement",
    ...ItemChoiceConfigurationData.LOCALIZATION_PREFIXES
  ];

  static defineSchema() {
    const schema = super.defineSchema();

    schema.pool = new ArrayField(new SchemaField({
      uuid: new StringField({ required: true, blank: false }),
      minLevel: new NumberField({
        integer: true,
        min: 0,
        initial: 1,
        label: "LGIC.Config.MinLevel"
      }),
      maxLevel: new NumberField({
        integer: true,
        min: 0,
        nullable: true,
        initial: null,
        label: "LGIC.Config.MaxLevel"
      })
    }));

    return schema;
  }

  static migrateData(source) {
    super.migrateData(source);

    if ( "pool" in source ) {
      source.pool = source.pool.map(entry => {
        if ( foundry.utils.getType(entry) === "string" ) {
          return { uuid: entry, minLevel: 1, maxLevel: null };
        }

        return {
          uuid: entry.uuid,
          minLevel: Number(entry.minLevel ?? 1),
          maxLevel: entry.maxLevel === undefined || entry.maxLevel === "" ? null : Number(entry.maxLevel)
        };
      });
    }

    return source;
  }
}

/**
 * Config sheet: reuses the core dnd5e Item Choice config, replacing only the pool list template.
 */
class LGICLevelGatedItemChoiceConfig extends ItemChoiceConfig {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ["item-choice", "three-column", "level-gated-item-choice"]
  }, { inplace: false });

  static PARTS = foundry.utils.mergeObject(super.PARTS, {
    items: {
      container: { classes: ["column-container"], id: "column-center" },
      template: `modules/${MODULE_ID}/templates/level-gated-item-choice-config-items.hbs`
    }
  }, { inplace: false });

  async prepareConfigurationUpdate(configuration) {
    if ( configuration.pool ) {
      configuration.pool = Object.values(configuration.pool).map(entry => {
        const min = Number(entry.minLevel ?? 1);
        const max = entry.maxLevel === "" || entry.maxLevel === undefined || entry.maxLevel === null
          ? null
          : Number(entry.maxLevel);

        return {
          uuid: entry.uuid,
          minLevel: Number.isFinite(min) ? min : 1,
          maxLevel: Number.isFinite(max) ? max : null
        };
      });
    }

    return super.prepareConfigurationUpdate(configuration);
  }
}

/**
 * Flow sheet: filters the configured Item Choice pool to the active advancement level.
 */
class LGICLevelGatedItemChoiceFlow extends ItemChoiceFlow {
  async _prepareContentContext(context, options) {
    this.pool = (
      await Promise.all(
        this.advancement.getPoolForLevel(this.level).map(entry => fromUuid(entry.uuid))
      )
    ).filter(Boolean);

    context = await super._prepareContentContext(context, options);

    // The core Item Choice compendium browser only understands generic item filters.
    // For this custom advancement, choices must come from the configured level-gated pool.
    context.showBrowseButton = false;

    return context;
  }

  /** @override */
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
      ui.notifications.error(game.i18n.format("LGIC.Warning.Unavailable", {
        name: item.name,
        level: this.level
      }));
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

/**
 * Advancement document: core Item Choice behavior plus level-gated pool filtering and apply-time validation.
 */
class LGICLevelGatedItemChoiceAdvancement extends ItemChoiceAdvancement {
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

  /**
   * Return configured pool entries available at the provided advancement level.
   * @param {number|string} level
   * @returns {Array<{uuid: string, minLevel: number, maxLevel: number|null}>}
   */
  getPoolForLevel(level) {
    const numericLevel = Number(level);

    return this.configuration.pool.filter(entry => {
      const min = Number(entry.minLevel ?? 0);
      const max = entry.maxLevel === null || entry.maxLevel === undefined ? Infinity : Number(entry.maxLevel);
      return (numericLevel >= min) && (numericLevel <= max);
    });
  }

  /**
   * Test whether a UUID is configured in the pool for this level.
   * @param {string} uuid
   * @param {number|string} level
   * @returns {boolean}
   */
  isUuidAvailableAtLevel(uuid, level) {
    return this.getPoolForLevel(level).some(entry => entry.uuid === uuid);
  }

  /** @override */
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

function isDnd5eActive() {
  return game.system?.id === "dnd5e" || globalThis.dnd5e?.id === "dnd5e";
}

function getAdvancementTypesRegistry() {
  return CONFIG.DND5E?.advancementTypes
    ?? game.dnd5e?.config?.advancementTypes
    ?? globalThis.dnd5e?.config?.advancementTypes
    ?? null;
}

function registerAdvancementType() {
  if ( !isDnd5eActive() ) {
    console.warn(`${MODULE_ID} | ${game.i18n?.localize?.("LGIC.Log.NotDnd5e") ?? "Active system is not dnd5e."}`);
    return false;
  }

  const types = getAdvancementTypesRegistry();
  if ( !types ) {
    console.warn(`${MODULE_ID} | ${game.i18n?.localize?.("LGIC.Log.MissingConfig") ?? "dnd5e advancement config was not available."}`);
    return false;
  }

  types[ADVANCEMENT_TYPE] = {
    documentClass: LGICLevelGatedItemChoiceAdvancement,
    validItemTypes: VALID_ITEM_TYPES
  };

  const module = game.modules.get(MODULE_ID);
  if ( module ) {
    module.api = {
      ADVANCEMENT_TYPE,
      LGICLevelGatedItemChoiceAdvancement,
      LGICLevelGatedItemChoiceConfig,
      LGICLevelGatedItemChoiceFlow,
      LGICLevelGatedItemChoiceConfigurationData
    };
  }

  return true;
}

// dnd5e creates CONFIG.DND5E during its own init hook. Registering against both the global dnd5e
// config object and CONFIG.DND5E makes the module resilient to hook ordering.
Hooks.once("init", registerAdvancementType);
Hooks.once("setup", registerAdvancementType);

Hooks.once("i18nInit", () => {
  registerAdvancementType();
  LGICLevelGatedItemChoiceAdvancement.localize?.();
});

Hooks.once("ready", () => {
  const registered = registerAdvancementType();
  if ( !registered ) {
    ui.notifications?.warn?.("Level-Gated Item Choice could not register. Check the browser console for details.");
    return;
  }

  console.log(`${MODULE_ID} | ${game.i18n.localize("LGIC.Log.Registered")}`);
});
