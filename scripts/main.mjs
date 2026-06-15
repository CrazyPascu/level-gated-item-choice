import {
  ADVANCEMENT_TYPE,
  MODULE_ID,
  VALID_ITEM_TYPES
} from "./constants.mjs";
import { buildClasses, getBuiltClasses } from "./classes/index.mjs";
import { getDnd5eParts, getRegistry } from "./foundry-api.mjs";
import { log, t, warn } from "./utils/i18n.mjs";

let LAST_ERROR = null;

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

    const classes = buildClasses(getDnd5eParts());
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
    getBuiltClasses()?.LGICLevelGatedItemChoiceAdvancement?.localize?.();
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
