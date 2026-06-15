export function getNamespace() {
  return game?.dnd5e ?? globalThis.dnd5e ?? null;
}

export function getRegistry() {
  return CONFIG?.DND5E?.advancementTypes
    ?? getNamespace()?.config?.advancementTypes
    ?? null;
}

export function getDnd5eParts() {
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
