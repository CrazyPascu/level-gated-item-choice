# Level-Gated Item Choice Advancement

A Foundry VTT add-on module for the dnd5e system.

It adds a custom advancement type called **Level-Gated Item Choice**. It behaves like dnd5e's normal **Choose Items** advancement, but each item in the configured pool also has an inclusive level range:

- **From Level**: first advancement level where this item can be selected.
- **Until Level**: last advancement level where this item can be selected. Leave blank for no upper limit.

The underlying advancement type key is namespaced as `LGICLevelGatedItemChoice` to avoid collisions with future dnd5e or module advancement types.

## Compatibility

- Foundry VTT: 14.363+
- dnd5e: 5.3.3+

## Installation

1. Unzip this folder into your Foundry data folder under:

   `Data/modules/level-gated-item-choice/`

2. Restart Foundry.
3. Enable **Level-Gated Item Choice Advancement** in your world's module settings.
4. Open an item that supports dnd5e advancement, such as a class, subclass, race/species, background, or feat.
5. Go to the Advancement tab and add **Level-Gated Item Choice**.

## Example

For the behavior:

- level 1: choose from items 1-10
- level 2: choose from items 1-20

Configure the pool like this:

- items 1-10: `From Level = 1`, `Until Level` blank
- items 11-20: `From Level = 2`, `Until Level` blank

Use the usual dnd5e advancement level/count controls to decide how many items can be picked at each level.

## Troubleshooting

Open the browser console and run:

```js
CONFIG.DND5E.advancementTypes.LGICLevelGatedItemChoice
```

If registration worked, that should return an object with a `documentClass`.

If it returns `undefined`, make sure:

1. the module is enabled in the world;
2. the active system is dnd5e;
3. the module folder is exactly `Data/modules/level-gated-item-choice/`;
4. the browser console does not show an import error.

This v0.2.0 build registers during `init`, `setup`, `i18nInit`, and `ready` so it is resilient to dnd5e hook ordering.
