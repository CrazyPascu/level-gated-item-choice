# Level-Gated Item Choice Advancement

Adds a dnd5e advancement type named **Level-Gated Item Choice**.

It behaves like dnd5e's built-in **Choose Items** advancement, but its item pool is configured with level sections from **1 to 20**.

## How it works

In the advancement configuration window, the item pool is divided into level drop zones:

- Drop an item in **Level 1** if it should be available from level 1 onward.
- Drop an item in **Level 2** if it should be available from level 2 onward.
- Continue through level 20.

Once an item becomes available, it remains available at later levels.

You can also drag an item that is already in the pool from one level section to another section to change when it becomes available.

## Example

- Items 1–10: drop them into **Level 1**.
- Items 11–20: drop them into **Level 2**.

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
