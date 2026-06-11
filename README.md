# Level-Gated Item Choice Advancement

Adds a dnd5e advancement type named **Level-Gated Item Choice**.

It behaves like dnd5e's built-in **Choose Items** advancement, but each item in the configured pool has one additional field:

- **min**: the first advancement level where the item is selectable.

There is no per-item maximum in this version. Once an item becomes available, it remains available at later advancement levels.

When you drop a new item into the pool, its `min` value inherits the previous row's `min` value. For example, if the current rows are:

```text
1
1
1
1
2
```

The next item you add will start with:

```text
2
```

## Example

- Items 1–10: min = 1
- Items 11–20: min = 2

At level 1, the player sees items 1–10. At level 2, the player sees items 1–20.

## Installation

1. Delete any old `Data/modules/level-gated-item-choice/` folder.
2. Unzip this package into `Data/modules/` so the final path is:
   `Data/modules/level-gated-item-choice/module.json`
3. Restart Foundry.
4. Enable **Level-Gated Item Choice Advancement** in Manage Modules.
5. Reload the world.

This build shows a Foundry notification on world load. If it registers successfully, you will see:

> Level-Gated Item Choice is registered.

If you see no notification at all, the module is not being loaded by Foundry.

## Compatibility

- Foundry VTT: 14.x, verified 14.363
- dnd5e system: 5.3.x, verified 5.3.3

## Notes

The compendium browser button is hidden for this advancement type because the core dnd5e item browser does not know this module's per-item level gates. Use the configured pool instead.
