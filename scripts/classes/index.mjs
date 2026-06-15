import { createAdvancementClass } from "./advancement.mjs";
import { createConfigClass } from "./config-app.mjs";
import { createConfigurationDataClass } from "./configuration-data.mjs";
import { createFlowClass } from "./flow-app.mjs";

let CLASSES = null;

export function buildClasses({
  ItemChoiceAdvancement,
  ItemChoiceConfig,
  ItemChoiceFlow,
  ItemChoiceConfigurationData,
  ItemChoiceValueData
}) {
  if ( CLASSES ) return CLASSES;

  const LGICLevelGatedItemChoiceConfigurationData = createConfigurationDataClass(ItemChoiceConfigurationData);
  const LGICLevelGatedItemChoiceConfig = createConfigClass(ItemChoiceConfig);
  const LGICLevelGatedItemChoiceFlow = createFlowClass(ItemChoiceFlow);
  const LGICLevelGatedItemChoiceAdvancement = createAdvancementClass(ItemChoiceAdvancement, {
    LGICLevelGatedItemChoiceConfigurationData,
    LGICLevelGatedItemChoiceConfig,
    LGICLevelGatedItemChoiceFlow,
    ItemChoiceValueData
  });

  CLASSES = {
    LGICLevelGatedItemChoiceAdvancement,
    LGICLevelGatedItemChoiceConfig,
    LGICLevelGatedItemChoiceFlow,
    LGICLevelGatedItemChoiceConfigurationData
  };

  return CLASSES;
}

export function getBuiltClasses() {
  return CLASSES;
}
