import { MODULE_ID } from "../constants.mjs";
import { clampLevel, getMaxSectionLevel } from "../utils/levels.mjs";
import { t } from "../utils/i18n.mjs";
import { sortItemsByName } from "../utils/pool.mjs";

export function createFlowClass(ItemChoiceFlow) {
  return class LGICLevelGatedItemChoiceFlow extends ItemChoiceFlow {
    static get DEFAULT_OPTIONS() {
      const base = super.DEFAULT_OPTIONS ?? {};
      const classes = [...new Set([...(base.classes ?? []), "level-gated-item-choice", "lgic-choice-flow"])] ;
      return foundry.utils.mergeObject(base, { classes }, { inplace: false });
    }

    static get PARTS() {
      return foundry.utils.mergeObject(super.PARTS ?? {}, {
        content: {
          template: `modules/${MODULE_ID}/templates/level-gated-item-choice-flow.hbs`
        }
      }, { inplace: false });
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
      this._prepareLevelSections(context);
      return context;
    }

    _prepareLevelSections(context) {
      const sections = Array.from(context.sections ?? []);
      const maxLevel = getMaxSectionLevel();
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

      const selectedSections = new Map();
      const choiceSections = new Map();

      const addToSection = (map, item, sourceSection) => {
        const minLevel = levelForItem(item);
        const header = this.advancement.getRegionTitle(minLevel, { flow: true });
        const key = `${minLevel}.${header}`;

        if ( !map.has(key) ) {
          map.set(key, {
            ...sourceSection,
            level: minLevel,
            header,
            items: []
          });
        }

        map.get(key).items.push(item);
      };

      const selectedItems = [];
      const choiceItems = [];

      for ( const section of sections ) {
        for ( const item of section.items ?? [] ) {
          if ( section.isCurrentLevel ) {
            choiceItems.push({ item, section });
            continue;
          }

          selectedItems.push({ item, section });
        }
      }

      const selectedUuids = new Set();
      for ( const { item, section } of selectedItems ) {
        selectedUuids.add(item.uuid);
        addToSection(selectedSections, {
          ...item,
          disabled: true,
          lgicCurrentSelection: false
        }, {
          ...section,
          isCurrentLevel: false
        });
      }

      for ( const { item, section } of choiceItems ) {
        if ( selectedUuids.has(item.uuid) ) continue;
        addToSection(choiceSections, item, section);
      }

      const prepareSections = map => {
        return Array.from(map.values()).sort((a, b) => a.level - b.level).map(section => {
          sortItemsByName(section.items);
          return section;
        });
      };

      context.previousSections = prepareSections(selectedSections);
      context.choiceLevelSections = prepareSections(choiceSections);
      context.currentChoiceHeader = sections.find(section => section.isCurrentLevel)?.header;
      context.sections = [
        ...context.previousSections,
        ...context.choiceLevelSections
      ];
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
  };
}
