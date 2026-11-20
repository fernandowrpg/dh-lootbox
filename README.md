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

## Merchant: buying and selling with the players

Any chest — a rolled loot chest, a consumables shop or one you filled by hand —
can be **put up for sale**. It becomes a merchant: players buy from her stock
and sell her items from their sheets, at prices the GM sets. When the player
confirms, the items move both ways and only the difference in gold changes hands.

**GM — putting a chest up for sale**

- On an existing chest, click **"Put up for sale (merchant)"** in the sheet
  header. To create chests (or a shop) already for sale, tick **"Put up for
  sale"** in the generation dialog — handy for treasure chests you drop on the
  scene.
- A chest for sale gets **Observer** as default permission: players see the
  stock but can't take items or change anything. **"Take off sale"** brings the
  previous permission back.

**GM — prices**

- **Default price list** (button **"Default list"** in any price list window,
  or `api.openDefaultPriceTable()`): used by every chest for sale that has no
  list of its own, so generated chests are ready to trade. Until you save it,
  it comes pre-filled from the core book's "Average Costs" table (charges:
  weapons/armor/loot 3 handfuls · 1.5 bags · 7.5 bags · 1.5 chests for Tiers
  1–4; consumables 2 handfuls · 5 handfuls · 2 bags · 5 bags; she pays about
  half). The book leaves consumables and loot unpriced, so those are a suggestion.
- **Price list** of a chest (button in its header): saving it gives that chest
  its own list; **"Use the default list"** goes back to the default one.
- Each list has two grids, **what she pays** (buying from players) and **what
  she charges** (selling to players), per item type and Tier. Weapons and armor
  use the item's Tier; consumables and loot use their rarity in the system's
  "Loot" and "Consumables" tables (Common = Tier 1 … Legendary = Tier 4).
- **Per-item prices**: drag items from a compendium, the sidebar or a sheet onto
  the list to give them their own "pays" and "charges" prices. An empty field
  follows the grid; **"Add her stock"** lists everything she has.
- Values are in **handfuls** (10 handfuls = 1 bag, 10 bags = 1 chest; with coins
  enabled in the system's Homebrew settings, use decimals: 0.5 = 5 coins).
  **0 means she doesn't trade the item that way** (won't buy it / not for sale).
- **Trade purse**: where the gold of each trade comes from and goes to. By
  default it is the chest being traded with. Pick **the merchant's chest** and
  every chest using that list — e.g. treasure chests for sale on the scene,
  through the default list — sells on her behalf: players pay into her chest
  and she pays them from it. The items still come from / go to the chest the
  player is trading with.
- **Bottomless purse**: when unchecked, the purse pays from its own gold
  (refusing what it can't afford) and keeps what it receives. When checked,
  its gold never changes.

**Player — the trade counter**

1. Open the merchant's sheet and click **"Trade counter"** (dragging an item
   from your sheet onto hers also opens it). Pick your **character** at the top
   if you have more than one.
2. **You sell**: drag items from your sheet onto the counter.
   **You buy**: click **+** next to an item in her stock.
3. Adjust quantities and check the sums: what she pays, what she charges and
   the balance ("you receive" or "you pay"). Items she won't trade, or that are
   equipped, are marked and don't count.
4. **Confirm trade**. Nothing moves until this moment.

**How the trade is carried out**

- The player has no permission on the merchant, so the counter sends the trade
  to the **active GM** as a Foundry query (`CONFIG.queries`, v13+). The GM's
  client checks it again (owner of the character, quantities, stock, prices,
  both purses) and then moves everything: items both ways (consumables and loot
  stack with what each side has) and the difference in gold, giving change when
  a larger coin has to be broken.
- One trade runs at a time, so two players can't spend the same purse or buy
  the same item twice.
- A summary is whispered to the GM and the player. **A GM must be connected**;
  otherwise the counter says so and nothing moves.
- From macros: `api.setMerchant(actor, true)`, `api.openPriceTable(actor)`,
  `api.openDefaultPriceTable()` and `api.openTradeCounter(actor)` on
  `game.modules.get('dh-lootbox').api`.

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
  **chest for sale** is the exception: it is set to Observer (see above), and
  players get its items by buying them at the trade counter.
- The gold amounts per Tier are an approximate suggestion (the site doesn't
  define a fixed "gold per chest" table); adjust the values on the chest
  sheet at any time before handing it to the players.
- To generate several chests at once (e.g., to scatter across different rooms
  of a dungeon), use the "Number of chests to create" field in the dialog.
- The module ships with English and Português (Brasil) translations; it
  follows whatever language is set in your Foundry client.
