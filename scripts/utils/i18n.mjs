import { MODULE_ID } from "../constants.mjs";

export function t(key, data = {}) {
  const i18n = game?.i18n;
  if ( !i18n ) return key;
  return Object.keys(data).length ? i18n.format(key, data) : i18n.localize(key);
}

export function log(message, ...args) {
  console.log(`${MODULE_ID} | ${message}`, ...args);
}

export function warn(message, ...args) {
  console.warn(`${MODULE_ID} | ${message}`, ...args);
}

export function debugChildSearch(message, data = {}) {
  console.log(`${MODULE_ID} | child pool scan | ${message}`, data);
}
