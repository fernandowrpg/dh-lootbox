# Loot Chests — Daggerheart

*[Leia em Português](README.pt-BR.md)*

A **Foundry VTT v13** (tested on v13.351) module for the **Daggerheart v1.9.14**
system that generates loot chests following the official tier/rarity loot
generation rules (https://daggerheart.org/core-mechanics/loot and
/consumables), using the system's real compendiums — the rolled items **are**
compendium documents (weapons, armor, consumables, and "Loot" items), so they
arrive ready to drag onto a character sheet.

## How it works under the hood

- Rolls on the **"Loot"** and **"Consumables"** RollTables that already ship
  inside the Daggerheart system's `rolltables` compendium, using the dice
  formula that matches the rarity of the chosen Tier (Common `2d12`, Uncommon
  `3d12`, Rare `4d12`, Legendary `5d12` — exactly as described on the site).
- Rolls a configurable number of weapons and armor pieces (one field each),
  filtered by the `system.tier` field on the `weapons`/`armors` compendiums.
- Optionally rolls gold (handfuls/bags/chests) using an approximate range per
  Tier, inspired by the GM guide's "Average Cost" table for equipment by Tier.
- The chest itself is a **"party"-type Actor** (the same type used for the
  party sheet), because that type already ships with: a gold field, item
  restriction to weapon/armor/consumable/loot, and — most importantly — **the
  system already implements drag-and-drop item (and gold) transfer from a
  "party" Actor straight to a "character" Actor**, with all quantity/stacking
  handled automatically. The module only swaps in a simplified sheet (just
  Inventory, without the "Party Members"/"Rest" tabs that don't apply to a
  chest).
- The chest's default permission is set to **Owner** for every player, so any
  player can open the sheet and take items without the GM having to configure
  permissions individually.

## Installation

**Option A — via manifest URL (recommended):**

1. In the Foundry Setup screen, go to **Add-on Modules** → **Install Module**.
2. Paste the manifest URL:
   `https://github.com/fernandowrpg/dh-lootbox/releases/latest/download/module.json`
3. Click **Install**.

**Option B — manual:**

1. Download the `dh-lootbox.zip` from the [latest release](https://github.com/fernandowrpg/dh-lootbox/releases/latest)
   and extract it into your Foundry installation's `Data/modules/` folder, so
   that `module.json` ends up at `Data/modules/dh-lootbox/module.json`.
2. Open your world (which must be running the **Daggerheart** system).
3. Go to **Manage Modules** and enable **"Loot Chests — Daggerheart"**.
4. Reload the world.

## Consumables Shop

The **"🧪 Create Consumables Shop"** macro (or `game.modules.get('dh-lootbox').api.openShopDialog()`)
lists **every** consumable in the `daggerheart.consumables` compendium. Filter by name,
check what the merchant sells and how many of each; the module creates an Actor
(same sheet as the chests) holding that stock, ready for players to drag items onto
their character sheet.

## Merchant: buying items from the players

Any chest (or shop) can become a **merchant** who buys items from the players.
The GM sets what she pays; when the player confirms, the items go to her and the
gold goes to the character automatically.

**GM — setting up a merchant**

1. Open the chest's sheet and click **"Make merchant"** in the header. The
   chest's default permission becomes **Observer**: players can see the stock
   but can no longer take items from it or change it (the previous permission
   comes back if you click **"Stop being a merchant"**).
2. The **Price list** opens (it is also in the header):
   - **Default price by type and Tier**: what she pays per unit for weapons,
     armor, consumables and loot items. Weapons and armor use the item's Tier;
     consumables and loot use their rarity in the system's "Loot" and
     "Consumables" tables (Common = Tier 1 … Legendary = Tier 4).
   - **Per-item prices**: drag items from a compendium, the sidebar or a sheet
     onto the list to give them their own price, which overrides the default.
     **"Add her stock"** fills the list with what she already has.
   - Values are in **handfuls** (10 handfuls = 1 bag, 10 bags = 1 chest; with
     coins enabled in the system's Homebrew settings, use decimals: 0.5 = 5
     coins). **0 means she doesn't buy it.**
   - **Bottomless purse**: when unchecked, she pays from the gold on her own
     sheet and refuses sales above what she has. When checked, her gold is not
     touched.

**Player — selling**

1. Open the merchant's sheet and drag an item from your character sheet onto
   it (or onto the **Trade counter** window, opened from the header).
2. The counter lists each item with what she pays for it. Adjust quantities,
   remove what you don't want to sell, and check the total. Items she won't buy,
   or that are equipped, are marked and don't count.
3. **Confirm sale**. The items stay on your sheet until this moment.

**How the sale is carried out**

- The player has no permission on the merchant, so the counter sends the sale
  to the **active GM** as a Foundry query (`CONFIG.queries`, v13+). The GM's
  client checks it again (owner of the character, quantities, prices, her gold)
  and then moves everything: the items to the merchant (consumables and loot
  stack with what she has) and the gold to the character, split into chests,
  bags and handfuls.
- One sale runs at a time, so two players can't spend the same purse.
- A summary is whispered to the GM and the player. **A GM must be connected**;
  otherwise the counter says so and nothing moves.
- From macros: `api.setMerchant(actor, true)`, `api.openPriceTable(actor)` and
  `api.openTradeCounter(actor)` on `game.modules.get('dh-lootbox').api`.

## How to use it

1. A macro named **"🎁 Generate Loot Chest"** (or the Portuguese equivalent,
   if your Foundry language is set to Português) is automatically added to
   the GM's hotbar the first time the world loads with the module active.
   Click it (or run `game.modules.get('dh-lootbox').api.openChestDialog()`
   from a script macro/console).
2. Choose the chest's **Tier** (1 to 4) and the **dice distribution**:
   - *Uniform (single die)* — e.g. `1d12` for Tier 1 — gives every item in that
     rarity's range an equal chance and never exceeds it.
   - *Bell curve (multiple dice)* — e.g. `2d12` for Tier 1 — favors results in
     the middle of the range, but can occasionally reach a bit into the next
     rarity up. This matches the default formulas the Daggerheart system's own
     RollTables ship with, and is selected by default.

   Both options come straight from the site's rules (for example, Tier 1 /
   Common explicitly allows `1d12 or 2d12`). The item/consumable/weapon/armor
   counts and the "include gold" checkbox are pre-filled with a
   sensible default for the selected Tier, but can be freely adjusted before
   confirming.
3. Check **"Automatically place at the center of the current scene"** if you
   want the chest to immediately show up as a token on the open scene — or
   leave it unchecked and just drag the generated Actor (it lands in a
   "Loot Chests" folder in the **Actors** tab) onto the map the normal way.
4. A summary of each chest's contents is whispered to the **GM only** in
   chat, as a spoiler-free record.
5. Players open the chest's token sheet (double-click) and **drag** any item
   (or the gold) straight onto their own character sheet — the transfer
   (quantity, removal from the chest, addition to the sheet) is handled
   automatically by the Daggerheart system itself.

## Notes and limitations

- Since the chest uses the "party" Actor type, it will show up in the Actors
  list alongside character sheets — the chest's name (e.g. "Chest — Tier 2
  (Uncommon)") helps tell them apart.
- "Owner" permission for every player means any connected player can modify
  the chest (including deleting items) — this is the simplest model for a
  shared loot container. If you want to restrict it, adjust permissions
  manually from the Actor sheet (gear icon in the window header). A
  **merchant** is the exception: she is set to Observer (see above), and only
  the GM can hand her stock out.
- The gold amounts per Tier are an approximate suggestion (the site doesn't
  define a fixed "gold per chest" table); adjust the values on the chest
  sheet at any time before handing it to the players.
- To generate several chests at once (e.g., to scatter across different rooms
  of a dungeon), use the "Number of chests to create" field in the dialog.
- The module ships with English and Português (Brasil) translations; it
  follows whatever language is set in your Foundry client.
