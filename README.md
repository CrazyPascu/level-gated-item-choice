# Level-Gated Item Choice Advancement

Adds a dnd5e advancement type named **Level-Gated Item Choice**.

It behaves like dnd5e's built-in **Choose Items** advancement, but its item pool is configured with level sections from **1 to 20**.

## How it works

In the advancement configuration window, the item pool is divided into level drop zones:

- Drop an item in **Level 1** if it should be available from level 1 onward.
- Drop an item in **Level 2** if it should be available from level 2 onward.
- Continue through level 20.

Once an item becomes available, it remains available at later levels.

You can also drag an item that is already in the pool from one level section to another section to change when it becomes available. Click a level header to collapse or expand that section; the arrow on the right shows whether it is open or closed.

## Example

- Items 1–10: drop them into **Level 1**.
- Items 11–20: drop them into **Level 2**.

At level 1, the player sees items 1–10. At level 2, the player sees items 1–20.

## Compatibility

- Foundry VTT: 14.x, verified 14.363
- dnd5e system: 5.3.x, verified 5.3.3

## Notes

The compendium browser button is hidden for this advancement type because the core dnd5e item browser does not know this module's per-item level gates. Use the configured pool instead.

## Parent and Child Pools

Each advancement can now be configured as one of three pool roles:

- **Standalone**: uses only its own pool.
- **Parent / Main Pool**: uses its own pool plus any child pools on the same actor that target its Pool ID.
- **Child / Contribute to Parent**: contributes its pool to the matching parent pool and does not create its own choice prompt.

To link pools, set the parent advancement to **Parent / Main Pool** and give it a **Pool ID**, such as `eldritch-invocations`.
Then set the child advancement to **Child / Contribute to Parent** and set its **Parent Pool ID** to the same value.

When a character has both features, the parent advancement is the only selector and its available pool includes the child pool entries. Duplicate entries are merged using the earliest minimum level.

## Custom Region Titles

Each level section has an optional title field in its header. Leave it blank to use the default **Level X** / **Available from Level X+** labels. The same title is used when grouping choices in the player selection flow.

## Pending Child Pool Detection

When a parent advancement selects an item that contains a matching child advancement, the module now scans the selected source item directly. This allows the parent pool to include child pool options even before the selected item has been fully committed to the actor by the dnd5e advancement workflow.


## 0.11.1

- Scans the advancement manager clone and all current manager steps for selected source UUIDs when merging child pools.
- Uses region titles for both current and previously selected items in the selection flow.
- Passes the just-selected UUID directly into pending child-pool detection so child pools can appear immediately after selection.


## 0.11.2

- Adds console debug logs around child pool scanning. Look for `level-gated-item-choice | child pool scan | ...` in the browser console.
- Scans UUIDs found deeper in the advancement manager object to catch selected-but-not-committed child feature items.
- Merges duplicate selection subsections that have the same region title/level, so selected and available items for the same region appear together.
- Adds a name-based fallback for already selected items so they are grouped under their configured region instead of the level where they were selected.


## 0.12.3

- Recursively scans selected/granted items for nested child pools, so chains like B grants C grants D can contribute all matching child pools to the parent.
- Keeps selected and selectable subsections separate while still merging duplicate headers within each mode.
- Keeps child-pool scan console logs under `level-gated-item-choice | child pool scan | ...`.
