import { MAX_SECTION_LEVEL, MODULE_ID } from "../constants.mjs";
import { clampLevel, getMaxSectionLevel } from "../utils/levels.mjs";
import { t } from "../utils/i18n.mjs";
import {
  cleanPoolId,
  cleanSectionTitle,
  getSectionTitle,
  normalizePoolRole,
  sortItemsByName
} from "../utils/pool.mjs";

export function createConfigClass(ItemChoiceConfig) {
  return class LGICLevelGatedItemChoiceConfig extends ItemChoiceConfig {
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
      const maxLevel = getMaxSectionLevel();
      const collapsedLevels = this.loadCollapsedLevels();
      const sections = new Map();

      for ( let level = 1; level <= maxLevel; level++ ) {
        const defaultLabel = t("LGIC.Config.LevelLabel", { level });
        const titleValue = getSectionTitle(this.advancement.configuration, level, { fallback: false });

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
        sortItemsByName(section.items);
      }

      const poolRole = normalizePoolRole(this.advancement.configuration.poolRole);
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
        const maxLevel = getMaxSectionLevel();
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

      configuration.poolRole = normalizePoolRole(configuration.poolRole);
      configuration.poolId = cleanPoolId(configuration.poolId);
      configuration.parentPoolId = cleanPoolId(configuration.parentPoolId);

      if ( configuration.poolRole !== "parent" ) configuration.poolId = "";
      if ( configuration.poolRole !== "child" ) configuration.parentPoolId = "";

      const sectionTitles = configuration.sectionTitles ?? {};
      configuration.sectionTitles = Object.fromEntries(
        Array.from({ length: MAX_SECTION_LEVEL }, (_, index) => {
          const level = index + 1;
          return [level, cleanSectionTitle(sectionTitles[level])];
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
        const role = normalizePoolRole(roleSelect?.value);
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
  };
}
