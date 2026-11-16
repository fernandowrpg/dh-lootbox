/**
 * Loot Chests — Daggerheart
 * ---------------------------------------------------------------------------
 * Generates loot chests (Actors of type "party" reused as containers) following
 * the tier/rarity loot generation rules described at
 * https://daggerheart.org/core-mechanics/loot and /consumables, using the
 * RollTables and compendiums that already ship with the Daggerheart system
 * (packs: daggerheart.rolltables, daggerheart.loot, daggerheart.consumables,
 * daggerheart.weapons, daggerheart.armors).
 *
 * The rolled items are real compendium documents, so they arrive ready to be
 * dragged onto a character sheet — the Daggerheart system already knows how to
 * transfer items (and gold) via drag-and-drop between a "party" Actor and a
 * "character" Actor, so that is reused here as the "open the chest and take
 * the item" mechanism.
 */

import {
    PriceTable,
    TradeCounter,
    isMerchant,
    merchantCreateData,
    registerTrade,
    setMerchant,
    tradeApi
} from './trade.js';

const MODULE_ID = 'dh-lootbox';
const CHEST_ICON = 'systems/daggerheart/assets/icons/documents/items/open-treasure-chest.svg';

/** Suggested default configuration for each Tier, per the site's tables.
 *  Each tier has two valid dice options (per https://daggerheart.org/core-mechanics/loot):
 *  a "uniform" single die (flat odds, capped at that rarity's range) and a
 *  "bellCurve" multi-dice sum (weighted toward the middle, extends slightly
 *  into the next rarity's range). The GM picks which one to use per chest. */
const TIER_DEFAULTS = {
    1: {
        rarityName: 'Common',
        diceOptions: { uniform: '1d12', bellCurve: '2d12' },
        lootCount: 1,
        consumableCount: 1,
        weaponCount: 0,
        armorCount: 0,
        goldFormula: { handfuls: '1d4' }
    },
    2: {
        rarityName: 'Uncommon',
        diceOptions: { uniform: '2d12', bellCurve: '3d12' },
        lootCount: 2,
        consumableCount: 2,
        weaponCount: 1,
        armorCount: 0,
        goldFormula: { bags: '1', handfuls: '1d4' }
    },
    3: {
        rarityName: 'Rare',
        diceOptions: { uniform: '3d12', bellCurve: '4d12' },
        lootCount: 2,
        consumableCount: 3,
        weaponCount: 1,
        armorCount: 0,
        goldFormula: { bags: '1d6 + 4' }
    },
    4: {
        rarityName: 'Legendary',
        diceOptions: { uniform: '4d12', bellCurve: '5d12' },
        lootCount: 3,
        consumableCount: 3,
        weaponCount: 1,
        armorCount: 0,
        goldFormula: { chests: '1d2' }
    }
};

const DEFAULT_DICE_MODE = 'bellCurve';

/** Resolves the actual dice formula for a Tier + dice mode ('uniform' | 'bellCurve'). */
function getDiceFormula(tier, diceMode) {
    const cfg = TIER_DEFAULTS[tier];
    if (!cfg) return null;
    return cfg.diceOptions[diceMode] ?? cfg.diceOptions[DEFAULT_DICE_MODE];
}

/** Localized display name for a rarity (matches the RollTable's alt-formula names). */
function getRarityLabel(rarityName) {
    return game.i18n.localize(`DHLOOTBOX.Rarity.${rarityName}`);
}

/** Localized default chest name for a given Tier, e.g. "Chest — Tier 2 (Uncommon)". */
function getDefaultChestName(tier) {
    const cfg = TIER_DEFAULTS[tier];
    if (!cfg) return game.i18n.localize('DHLOOTBOX.DefaultChestHeaderFallback');
    return game.i18n.format('DHLOOTBOX.DefaultChestName', { tier, rarity: getRarityLabel(cfg.rarityName) });
}

/* -------------------------------------------------------------------------- */
/*  Chest sheet (reuses the system's "Party" sheet)                          */
/* -------------------------------------------------------------------------- */

function registerChestSheet() {
    const { Party } = game.system.api.applications.sheets.actors;
    const { Actors } = foundry.documents.collections;

    class LootChestSheet extends Party {
        static DEFAULT_OPTIONS = foundry.utils.mergeObject(
            Party.DEFAULT_OPTIONS,
            {
                classes: ['party', 'loot-chest-sheet'],
                actions: {
                    toggleMerchant: LootChestSheet.#onToggleMerchant,
                    openPriceTable: LootChestSheet.#onOpenPriceTable,
                    openTradeCounter: LootChestSheet.#onOpenTradeCounter
                }
            },
            { inplace: false }
        );

        /* We only reuse header + tab navigation + inventory.
           The party-members / rest / notes tabs don't make sense for a chest. */
        static PARTS = {
            header: { template: `modules/${MODULE_ID}/templates/chest-header.hbs` },
            tabs: Party.PARTS.tabs,
            inventory: Party.PARTS.inventory
        };

        static TABS = {
            primary: {
                tabs: [{ id: 'inventory' }],
                initial: 'inventory',
                labelPrefix: 'DAGGERHEART.GENERAL.Tabs'
            }
        };

        async _preparePartContext(partId, context, options) {
            context = await super._preparePartContext(partId, context, options);
            if (partId === 'header') {
                const tier = this.document.getFlag(MODULE_ID, 'tier');
                context.isMerchant = isMerchant(this.document);
                context.isGM = game.user.isGM;
                context.tierLabel = context.isMerchant
                    ? game.i18n.localize('DHLOOTBOX.Trade.MerchantLabel')
                    : this.document.getFlag(MODULE_ID, 'isShop')
                    ? game.i18n.localize('DHLOOTBOX.Shop.HeaderLabel')
                    : tier
                    ? getDefaultChestName(tier)
                    : game.i18n.localize('DHLOOTBOX.DefaultChestHeaderFallback');
            }
            return context;
        }

        /* Players only have Observer access to a merchant, so Foundry disables every field
           of her sheet, buttons included. The trade counter must stay clickable. */
        _toggleDisabled(disabled) {
            super._toggleDisabled(disabled);
            for (const button of this.element?.querySelectorAll('[data-action="openTradeCounter"]') ?? []) {
                button.disabled = false;
            }
        }

        /* A merchant's stock is hers: players see it but can't drag it away. (On newer
           Daggerheart versions the GM would carry out that transfer without asking.) */
        async _onDragStart(event) {
            if (isMerchant(this.document) && !game.user.isGM) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            return super._onDragStart(event);
        }

        /* Items a player drops on a merchant go up for sale on the trade counter instead of being given away. */
        async _onDrop(event) {
            if (!isMerchant(this.document) || game.user.isGM) return super._onDrop(event);
            event.preventDefault();
            event.stopPropagation();
            const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
            if (data?.type !== 'Item' || !data.uuid) return;
            const item = await fromUuid(data.uuid);
            if (item?.actor?.uuid === this.document.uuid) return;
            await TradeCounter.open(this.document, { item });
        }

        static async #onToggleMerchant() {
            const enable = !isMerchant(this.document);
            await setMerchant(this.document, enable);
            if (enable) PriceTable.open(this.document);
        }

        static #onOpenPriceTable() {
            PriceTable.open(this.document);
        }

        static #onOpenTradeCounter() {
            TradeCounter.open(this.document);
        }
    }

    Actors.registerSheet(MODULE_ID, LootChestSheet, {
        types: ['party'],
        makeDefault: false,
        label: () => game.i18n.localize('DHLOOTBOX.SheetLabel')
    });

    return LootChestSheet;
}

/* -------------------------------------------------------------------------- */
/*  Roll utilities                                                            */
/* -------------------------------------------------------------------------- */

async function getRollTableByName(name) {
    const pack = game.packs.get('daggerheart.rolltables');
    if (!pack) throw new Error(game.i18n.format('DHLOOTBOX.Errors.PackNotFound', { pack: 'daggerheart.rolltables' }));
    const index = await pack.getIndex();
    const entry = index.find(e => e.name === name);
    if (!entry) throw new Error(game.i18n.format('DHLOOTBOX.Errors.TableNotFound', { name }));
    return pack.getDocument(entry._id);
}

async function rollFormula(formula) {
    const roll = new Roll(String(formula));
    await roll.evaluate();
    return roll.total;
}

/** Rolls `count` times on a RollTable using the given formula and returns the
 *  real Item documents (from the compendium) referenced by the results. */
async function drawFromTable(table, formula, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
        const { results } = await table.roll({ selectedFormula: formula });
        for (const result of results) {
            if (result.type === 'document' && result.documentUuid) {
                const doc = await fromUuid(result.documentUuid);
                if (doc) drawn.push(doc);
            }
        }
    }
    return drawn;
}

/** Rolls `count` random documents from an equipment pack, filtered to the chest's Tier. */
async function drawEquipment(packName, tier, count) {
    const pack = game.packs.get(packName);
    if (!pack || count <= 0) return [];

    const index = await pack.getIndex({ fields: ['system.tier'] });
    const options = index.filter(e => e.system?.tier === tier);
    if (!options.length) return [];

    const drawn = [];
    for (let i = 0; i < count; i++) {
        const chosen = options[Math.floor(Math.random() * options.length)];
        const doc = await fromUuid(chosen.uuid);
        if (doc) drawn.push(doc);
    }
    return drawn;
}

/** Ownership and flags for a new chest, turned into a merchant when `forSale` is set. */
function chestAccess(flags, forSale) {
    if (!forSale) return { ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }, flags };
    const merchant = merchantCreateData();
    return { ownership: merchant.ownership, flags: { ...flags, ...merchant.flags } };
}

async function getOrCreateChestFolder() {
    const folderName = game.i18n.localize('DHLOOTBOX.FolderName');
    let folder = game.folders.find(f => f.name === folderName && f.type === 'Actor');
    if (!folder) {
        folder = await Folder.create({ name: folderName, type: 'Actor', color: '#b8860b' });
    }
    return folder;
}

/* -------------------------------------------------------------------------- */
/*  Chest generation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} opts
 * @param {number} opts.tier               Chest Tier (1 to 4)
 * @param {string} [opts.name]              Name for the generated Actor
 * @param {number} [opts.lootCount]         How many items to roll on the "Loot" table
 * @param {number} [opts.consumableCount]   How many consumables to roll
 * @param {number} [opts.weaponCount]       How many weapons of the Tier to roll
 * @param {number} [opts.armorCount]        How many armor pieces of the Tier to roll
 * @param {boolean} [opts.includeEquipment] Legacy: rolls 1 weapon or armor (50/50) when no counts are given
 * @param {boolean} [opts.includeGold]      Rolls gold based on the Tier
 * @param {'uniform'|'bellCurve'} [opts.diceMode] Which dice option to use for this Tier's rarity
 * @param {boolean} [opts.forSale]          Creates the chest as a merchant who sells its contents
 * @returns {Promise<Actor>}
 */
async function generateLootChest(opts) {
    const tier = Number(opts.tier) || 1;
    const cfg = TIER_DEFAULTS[tier];
    if (!cfg) throw new Error(game.i18n.format('DHLOOTBOX.Errors.InvalidTier', { tier }));

    const diceMode = opts.diceMode === 'uniform' ? 'uniform' : DEFAULT_DICE_MODE;
    const formula = getDiceFormula(tier, diceMode);

    const lootCount = Number.isFinite(opts.lootCount) ? opts.lootCount : cfg.lootCount;
    const consumableCount = Number.isFinite(opts.consumableCount) ? opts.consumableCount : cfg.consumableCount;
    let weaponCount = Number.isFinite(opts.weaponCount) ? opts.weaponCount : null;
    let armorCount = Number.isFinite(opts.armorCount) ? opts.armorCount : null;
    if (weaponCount === null && armorCount === null && opts.includeEquipment !== undefined) {
        const rollWeapon = Math.random() < 0.5;
        weaponCount = opts.includeEquipment && rollWeapon ? 1 : 0;
        armorCount = opts.includeEquipment && !rollWeapon ? 1 : 0;
    }
    weaponCount ??= cfg.weaponCount;
    armorCount ??= cfg.armorCount;
    const includeGold = opts.includeGold ?? true;
    const name = opts.name?.trim() || getDefaultChestName(tier);

    const lootTable = await getRollTableByName('Loot');
    const consumablesTable = await getRollTableByName('Consumables');

    const lootDocs = lootCount > 0 ? await drawFromTable(lootTable, formula, lootCount) : [];
    const consumableDocs =
        consumableCount > 0 ? await drawFromTable(consumablesTable, formula, consumableCount) : [];

    const equipmentDocs = [
        ...(await drawEquipment('daggerheart.weapons', tier, weaponCount)),
        ...(await drawEquipment('daggerheart.armors', tier, armorCount))
    ];

    const allDocs = [...lootDocs, ...consumableDocs, ...equipmentDocs];
    const itemsData = allDocs.map(doc => {
        const data = doc.toObject();
        delete data._id; // avoid id collisions if the same item is rolled more than once
        return data;
    });

    const gold = { coins: 0, handfuls: 0, bags: 0, chests: 0 };
    if (includeGold) {
        for (const [key, formula] of Object.entries(cfg.goldFormula)) {
            gold[key] = await rollFormula(formula);
        }
    }

    const access = chestAccess({ isChest: true, tier }, opts.forSale);
    const folder = await getOrCreateChestFolder();

    const actor = await Actor.create({
        name,
        type: 'party',
        img: CHEST_ICON,
        folder: folder?.id,
        items: itemsData,
        system: { gold, partyMembers: [] },
        prototypeToken: {
            name,
            texture: { src: CHEST_ICON },
            actorLink: true,
            disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
            sight: { enabled: false }
        },
        ownership: access.ownership,
        flags: { core: { sheetClass: `${MODULE_ID}.LootChestSheet` }, [MODULE_ID]: access.flags }
    });

    await whisperChestSummaryToGM(actor, {
        tier,
        cfg,
        formula,
        lootDocs,
        consumableDocs,
        equipmentDocs,
        gold,
        includeGold
    });
    return actor;
}

async function whisperChestSummaryToGM(actor, { tier, cfg, formula, lootDocs, consumableDocs, equipmentDocs, gold, includeGold }) {
    const listItems = docs => docs.map(d => `<li>${d.name}</li>`).join('');
    const goldParts = [];
    if (includeGold) {
        if (gold.chests) goldParts.push(game.i18n.format('DHLOOTBOX.Summary.GoldChests', { count: gold.chests }));
        if (gold.bags) goldParts.push(game.i18n.format('DHLOOTBOX.Summary.GoldBags', { count: gold.bags }));
        if (gold.handfuls) goldParts.push(game.i18n.format('DHLOOTBOX.Summary.GoldHandfuls', { count: gold.handfuls }));
        if (gold.coins) goldParts.push(game.i18n.format('DHLOOTBOX.Summary.GoldCoins', { count: gold.coins }));
    }

    const tierLine = game.i18n.format('DHLOOTBOX.Summary.TierLine', {
        tier,
        rarity: getRarityLabel(cfg.rarityName),
        formula
    });

    const content = `
        <div class="daggerheart-loot-chest-summary">
            <h3>🎁 ${actor.name}</h3>
            <p><strong>${tierLine}</strong></p>
            ${lootDocs.length ? `<p><strong>${game.i18n.localize('DHLOOTBOX.Summary.Items')}</strong></p><ul>${listItems(lootDocs)}</ul>` : ''}
            ${consumableDocs.length ? `<p><strong>${game.i18n.localize('DHLOOTBOX.Summary.Consumables')}</strong></p><ul>${listItems(consumableDocs)}</ul>` : ''}
            ${equipmentDocs.length ? `<p><strong>${game.i18n.localize('DHLOOTBOX.Summary.Equipment')}</strong></p><ul>${listItems(equipmentDocs)}</ul>` : ''}
            ${goldParts.length ? `<p><strong>${game.i18n.localize('DHLOOTBOX.Summary.Gold')}</strong> ${goldParts.join(', ')}</p>` : ''}
        </div>
    `;

    await ChatMessage.create({
        content,
        whisper: ChatMessage.getWhisperRecipients('GM').map(u => u.id),
        speaker: { alias: game.i18n.localize('DHLOOTBOX.Summary.SpeakerAlias') }
    });
}

/* -------------------------------------------------------------------------- */
/*  Placing the chest on the map                                              */
/* -------------------------------------------------------------------------- */

async function placeChestOnCurrentScene(actor, offsetIndex = 0) {
    if (!canvas.ready || !canvas.scene) {
        ui.notifications.warn(game.i18n.format('DHLOOTBOX.Notifications.NoActiveScene', { name: actor.name }));
        return;
    }

    const rect = canvas.scene.dimensions?.sceneRect;
    const centerX = rect ? rect.x + rect.width / 2 : canvas.scene.width / 2;
    const centerY = rect ? rect.y + rect.height / 2 : canvas.scene.height / 2;
    const gridSize = canvas.scene.grid?.size ?? 100;
    const offsetX = centerX + offsetIndex * gridSize * 1.5;

    let tokenObject;
    if (typeof actor.getTokenDocument === 'function') {
        const tokenDoc = await actor.getTokenDocument({ x: offsetX, y: centerY });
        tokenObject = tokenDoc.toObject();
    } else {
        tokenObject = foundry.utils.mergeObject(actor.prototypeToken.toObject(), {
            x: offsetX,
            y: centerY,
            actorId: actor.id
        });
    }

    await canvas.scene.createEmbeddedDocuments('Token', [tokenObject]);
    ui.notifications.info(game.i18n.format('DHLOOTBOX.Notifications.ChestPlaced', { name: actor.name }));
}

/* -------------------------------------------------------------------------- */
/*  Generation dialog                                                         */
/* -------------------------------------------------------------------------- */

function buildDialogContent() {
    const L = key => game.i18n.localize(`DHLOOTBOX.Dialog.${key}`);
    return `
    <div class="daggerheart-loot-chest-dialog">
        <div class="form-group">
            <label>${L('TierLabel')}</label>
            <select name="tier">
                <option value="1">${L('Tier1')}</option>
                <option value="2">${L('Tier2')}</option>
                <option value="3">${L('Tier3')}</option>
                <option value="4">${L('Tier4')}</option>
            </select>
        </div>
        <div class="form-group">
            <label>${L('DiceModeLabel')}</label>
            <select name="diceMode">
                <option value="bellCurve">${L('DiceModeBellCurve')}</option>
                <option value="uniform">${L('DiceModeUniform')}</option>
            </select>
        </div>
        <p class="hint dice-formula-preview"></p>
        <p class="hint">${L('DiceModeHint')}</p>
        <div class="form-group">
            <label>${L('NameLabel')}</label>
            <input type="text" name="name" placeholder="${getDefaultChestName(1)}">
        </div>
        <div class="form-group">
            <label>${L('QuantityLabel')}</label>
            <input type="number" name="quantity" value="1" min="1" max="10" step="1">
        </div>
        <hr>
        <div class="form-group">
            <label>${L('LootCountLabel')}</label>
            <input type="number" name="lootCount" min="0" max="10" step="1">
        </div>
        <div class="form-group">
            <label>${L('ConsumableCountLabel')}</label>
            <input type="number" name="consumableCount" min="0" max="10" step="1">
        </div>
        <div class="form-group">
            <label>${L('WeaponCountLabel')}</label>
            <input type="number" name="weaponCount" min="0" max="10" step="1">
        </div>
        <div class="form-group">
            <label>${L('ArmorCountLabel')}</label>
            <input type="number" name="armorCount" min="0" max="10" step="1">
        </div>
        <div class="form-group form-group-checkbox">
            <label><input type="checkbox" name="includeGold" checked> ${L('IncludeGoldLabel')}</label>
        </div>
        <div class="form-group form-group-checkbox">
            <label><input type="checkbox" name="placeOnScene"> ${L('PlaceOnSceneLabel')}</label>
        </div>
        <div class="form-group form-group-checkbox">
            <label><input type="checkbox" name="forSale"> ${L('ForSaleLabel')}</label>
        </div>
        <p class="hint">${L('Hint')}</p>
    </div>`;
}

function wireDialogDefaults(rootElement) {
    const root = rootElement instanceof HTMLElement ? rootElement : rootElement?.element;
    if (!root) return;
    const container = root.querySelector('.daggerheart-loot-chest-dialog');
    if (!container) return;

    const tierSelect = container.querySelector('[name="tier"]');
    const diceModeSelect = container.querySelector('[name="diceMode"]');
    const nameInput = container.querySelector('[name="name"]');
    // Count inputs and the TIER_DEFAULTS key that pre-fills each one.
    const countInputs = [
        ['lootCount', 'lootCount'],
        ['consumableCount', 'consumableCount'],
        ['weaponCount', 'weaponCount'],
        ['armorCount', 'armorCount']
    ].map(([name, cfgKey]) => ({ input: container.querySelector(`[name="${name}"]`), cfgKey }));
    const formulaPreview = container.querySelector('.dice-formula-preview');
    if (!tierSelect) return;

    const updateFormulaPreview = () => {
        if (!formulaPreview) return;
        const tier = Number(tierSelect.value);
        const formula = getDiceFormula(tier, diceModeSelect.value);
        if (formula) {
            formulaPreview.textContent = game.i18n.format('DHLOOTBOX.Dialog.DiceFormulaPreview', { formula });
        }
    };

    const applyDefaults = () => {
        const tier = Number(tierSelect.value);
        const cfg = TIER_DEFAULTS[tier];
        if (!cfg) return;
        // Changing the Tier must not wipe counts the GM already typed in.
        for (const { input, cfgKey } of countInputs) {
            if (!input.dataset.userEdited) input.value = cfg[cfgKey];
        }
        if (!nameInput.dataset.userEdited) {
            nameInput.value = getDefaultChestName(tier);
        }
        updateFormulaPreview();
    };

    tierSelect.addEventListener('change', applyDefaults);
    diceModeSelect.addEventListener('change', updateFormulaPreview);
    for (const el of [nameInput, ...countInputs.map(c => c.input)]) {
        el.addEventListener('input', () => {
            el.dataset.userEdited = 'true';
        });
    }
    applyDefaults();
}

async function openChestDialog() {
    if (!game.user.isGM) {
        ui.notifications.warn(game.i18n.localize('DHLOOTBOX.Notifications.OnlyGM'));
        return;
    }

    let formResult;
    try {
        formResult = await foundry.applications.api.DialogV2.wait({
            window: { title: game.i18n.localize('DHLOOTBOX.Dialog.Title'), icon: 'fa-solid fa-treasure-chest' },
            content: buildDialogContent(),
            buttons: [
                {
                    action: 'generate',
                    label: game.i18n.localize('DHLOOTBOX.Dialog.GenerateButton'),
                    icon: 'fa-solid fa-treasure-chest',
                    default: true,
                    callback: (_event, button) => {
                        const form = button.form;
                        return {
                            tier: Number(form.elements.tier.value),
                            diceMode: form.elements.diceMode.value,
                            name: form.elements.name.value,
                            quantity: Math.max(1, Number(form.elements.quantity.value) || 1),
                            lootCount: Number(form.elements.lootCount.value) || 0,
                            consumableCount: Number(form.elements.consumableCount.value) || 0,
                            weaponCount: Number(form.elements.weaponCount.value) || 0,
                            armorCount: Number(form.elements.armorCount.value) || 0,
                            includeGold: form.elements.includeGold.checked,
                            placeOnScene: form.elements.placeOnScene.checked,
                            forSale: form.elements.forSale.checked
                        };
                    }
                },
                { action: 'cancel', label: game.i18n.localize('DHLOOTBOX.Dialog.CancelButton'), icon: 'fa-solid fa-xmark' }
            ],
            rejectClose: false,
            render: (_event, element) => {
                try {
                    wireDialogDefaults(element);
                } catch (err) {
                    console.warn(`${MODULE_ID} | Could not pre-fill dialog defaults`, err);
                }
            }
        });
    } catch (err) {
        console.error(`${MODULE_ID} | Error opening dialog`, err);
        ui.notifications.error(game.i18n.localize('DHLOOTBOX.Errors.DialogFailed'));
        return;
    }

    if (!formResult) return; // cancelled

    const createdActors = [];
    for (let i = 0; i < formResult.quantity; i++) {
        const chestName =
            formResult.quantity > 1 && formResult.name ? `${formResult.name} #${i + 1}` : formResult.name;
        try {
            const actor = await generateLootChest({ ...formResult, name: chestName });
            createdActors.push(actor);
            if (formResult.placeOnScene) {
                await placeChestOnCurrentScene(actor, i);
            }
        } catch (err) {
            console.error(`${MODULE_ID} | Error generating chest`, err);
            ui.notifications.error(game.i18n.format('DHLOOTBOX.Errors.GenerateFailed', { error: err.message }));
        }
    }

    if (createdActors.length) {
        ui.notifications.info(game.i18n.format('DHLOOTBOX.Notifications.ChestsGenerated', { count: createdActors.length }));
    }
}

/* -------------------------------------------------------------------------- */
/*  Consumables shop                                                          */
/* -------------------------------------------------------------------------- */

const CONSUMABLES_PACK = 'daggerheart.consumables';

/** Every consumable in the system compendium, sorted by name. */
async function getAllConsumables() {
    const pack = game.packs.get(CONSUMABLES_PACK);
    if (!pack) throw new Error(game.i18n.format('DHLOOTBOX.Errors.PackNotFound', { pack: CONSUMABLES_PACK }));
    const index = await pack.getIndex({ fields: ['img'] });
    return [...index].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/**
 * Creates a "shop" Actor (same container sheet as the chests) stocked with the
 * chosen consumables, so the merchant can hand them out by drag-and-drop.
 * @param {object} opts
 * @param {string} [opts.name]                         Name for the generated Actor
 * @param {{uuid: string, quantity: number}[]} opts.stock  Consumables and how many of each
 * @returns {Promise<Actor>}
 */
async function generateConsumableShop({ name, stock = [], forSale = false } = {}) {
    const itemsData = [];
    for (const { uuid, quantity } of stock) {
        const qty = Math.max(1, Number(quantity) || 1);
        const doc = await fromUuid(uuid);
        if (!doc) continue;
        const data = doc.toObject();
        delete data._id;
        // Stack into one item when the system tracks quantity, otherwise add copies.
        if (data.system && 'quantity' in data.system) {
            data.system.quantity = qty;
            itemsData.push(data);
        } else {
            for (let i = 0; i < qty; i++) itemsData.push(foundry.utils.deepClone(data));
        }
    }

    const shopName = name?.trim() || game.i18n.localize('DHLOOTBOX.Shop.DefaultName');
    const access = chestAccess({ isChest: true, isShop: true }, forSale);
    const folder = await getOrCreateChestFolder();
    return Actor.create({
        name: shopName,
        type: 'party',
        img: CHEST_ICON,
        folder: folder?.id,
        items: itemsData,
        system: { partyMembers: [] },
        prototypeToken: {
            name: shopName,
            texture: { src: CHEST_ICON },
            actorLink: true,
            disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
            sight: { enabled: false }
        },
        ownership: access.ownership,
        flags: { core: { sheetClass: `${MODULE_ID}.LootChestSheet` }, [MODULE_ID]: access.flags }
    });
}

function buildShopDialogContent(consumables) {
    const L = key => game.i18n.localize(`DHLOOTBOX.Shop.${key}`);
    const esc = foundry.utils.escapeHTML;
    const rows = consumables
        .map(
            e => `
            <li class="shop-row" data-name="${esc(e.name.toLowerCase())}">
                <label>
                    <input type="checkbox" name="pick" value="${e.uuid}">
                    <img src="${e.img}" alt="">
                    <span>${esc(e.name)}</span>
                </label>
                <input type="number" name="qty" data-uuid="${e.uuid}" value="1" min="1" max="99" step="1">
            </li>`
        )
        .join('');
    return `
    <div class="daggerheart-loot-chest-dialog daggerheart-shop-dialog">
        <div class="form-group">
            <label>${L('NameLabel')}</label>
            <input type="text" name="name" value="${esc(L('DefaultName'))}">
        </div>
        <div class="form-group">
            <input type="search" name="filter" placeholder="${esc(L('FilterPlaceholder'))}">
            <button type="button" data-shop="all">${L('SelectAll')}</button>
            <button type="button" data-shop="none">${L('SelectNone')}</button>
        </div>
        <ul class="shop-list">${rows}</ul>
        <div class="form-group form-group-checkbox">
            <label><input type="checkbox" name="placeOnScene"> ${game.i18n.localize('DHLOOTBOX.Dialog.PlaceOnSceneLabel')}</label>
        </div>
        <div class="form-group form-group-checkbox">
            <label><input type="checkbox" name="forSale"> ${game.i18n.localize('DHLOOTBOX.Dialog.ForSaleLabel')}</label>
        </div>
        <p class="hint">${L('Hint')}</p>
    </div>`;
}

function wireShopDialog(rootElement) {
    const root = rootElement instanceof HTMLElement ? rootElement : rootElement?.element;
    const container = root?.querySelector('.daggerheart-shop-dialog');
    if (!container) return;
    const rows = [...container.querySelectorAll('.shop-row')];
    const visible = () => rows.filter(r => !r.hidden);

    container.querySelector('[name="filter"]').addEventListener('input', event => {
        const term = event.target.value.trim().toLowerCase();
        for (const row of rows) row.hidden = term && !row.dataset.name.includes(term);
    });
    container.querySelector('[data-shop="all"]').addEventListener('click', () => {
        for (const row of visible()) row.querySelector('[name="pick"]').checked = true;
    });
    container.querySelector('[data-shop="none"]').addEventListener('click', () => {
        for (const row of visible()) row.querySelector('[name="pick"]').checked = false;
    });
    // Typing a quantity implies the GM wants that item.
    for (const row of rows) {
        row.querySelector('[name="qty"]').addEventListener('input', () => {
            row.querySelector('[name="pick"]').checked = true;
        });
    }
}

async function openShopDialog() {
    if (!game.user.isGM) {
        ui.notifications.warn(game.i18n.localize('DHLOOTBOX.Notifications.OnlyGM'));
        return;
    }

    let formResult;
    try {
        const consumables = await getAllConsumables();
        formResult = await foundry.applications.api.DialogV2.wait({
            window: { title: game.i18n.localize('DHLOOTBOX.Shop.Title'), icon: 'fa-solid fa-flask' },
            position: { width: 480 },
            content: buildShopDialogContent(consumables),
            buttons: [
                {
                    action: 'generate',
                    label: game.i18n.localize('DHLOOTBOX.Shop.GenerateButton'),
                    icon: 'fa-solid fa-store',
                    default: true,
                    callback: (_event, button) => {
                        const form = button.form;
                        const stock = [...form.querySelectorAll('[name="pick"]:checked')].map(cb => ({
                            uuid: cb.value,
                            quantity: Number(form.querySelector(`[name="qty"][data-uuid="${cb.value}"]`)?.value) || 1
                        }));
                        return {
                            name: form.elements.name.value,
                            stock,
                            placeOnScene: form.elements.placeOnScene.checked,
                            forSale: form.elements.forSale.checked
                        };
                    }
                },
                { action: 'cancel', label: game.i18n.localize('DHLOOTBOX.Dialog.CancelButton'), icon: 'fa-solid fa-xmark' }
            ],
            rejectClose: false,
            render: (_event, element) => wireShopDialog(element)
        });
    } catch (err) {
        console.error(`${MODULE_ID} | Error opening shop dialog`, err);
        ui.notifications.error(game.i18n.localize('DHLOOTBOX.Errors.DialogFailed'));
        return;
    }

    if (!formResult) return; // cancelled
    if (!formResult.stock.length) {
        ui.notifications.warn(game.i18n.localize('DHLOOTBOX.Shop.NothingSelected'));
        return;
    }

    try {
        const actor = await generateConsumableShop(formResult);
        if (formResult.placeOnScene) await placeChestOnCurrentScene(actor);
        ui.notifications.info(game.i18n.format('DHLOOTBOX.Shop.Created', { name: actor.name }));
        actor.sheet.render(true);
    } catch (err) {
        console.error(`${MODULE_ID} | Error generating shop`, err);
        ui.notifications.error(game.i18n.format('DHLOOTBOX.Errors.GenerateFailed', { error: err.message }));
    }
}

/** Creates (once) a script macro and pins it to the first free hotbar slot. */
async function ensureHotbarMacro(name, img, command) {
    let macro = game.macros.find(m => m.name === name);
    if (!macro) {
        macro = await Macro.create({ name, type: 'script', img, command, scope: 'global' });
    }

    const hotbar = game.user.hotbar ?? {};
    if (Object.values(hotbar).includes(macro.id)) return;
    for (let slot = 1; slot <= 50; slot++) {
        if (!hotbar[slot]) {
            await game.user.assignHotbarMacro(macro, slot);
            break;
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Module registration                                                       */
/* -------------------------------------------------------------------------- */

Hooks.once('init', () => {
    if (game.system.id !== 'daggerheart') return;
    registerChestSheet();
    registerTrade();
});

Hooks.once('ready', async () => {
    if (game.system.id !== 'daggerheart') return;

    const moduleData = game.modules.get(MODULE_ID);
    if (!moduleData) {
        console.error(
            `${MODULE_ID} | Could not find the module via game.modules.get('${MODULE_ID}'). ` +
                `Check that the folder in Data/modules is named exactly that, and that module.json's "id" field is "${MODULE_ID}".`
        );
        return;
    }
    moduleData.api = {
        openChestDialog,
        generateLootChest,
        placeChestOnCurrentScene,
        getDiceFormula,
        TIER_DEFAULTS,
        openShopDialog,
        generateConsumableShop,
        ...tradeApi
    };

    if (!game.user.isGM) return;

    // Create (once) convenience macros on the GM's hotbar.
    await ensureHotbarMacro(
        game.i18n.localize('DHLOOTBOX.MacroName'),
        CHEST_ICON,
        `game.modules.get('${MODULE_ID}').api.openChestDialog();`
    );
    await ensureHotbarMacro(
        game.i18n.localize('DHLOOTBOX.Shop.MacroName'),
        'icons/consumables/potions/potion-tube-corked-red.webp',
        `game.modules.get('${MODULE_ID}').api.openShopDialog();`
    );
});
