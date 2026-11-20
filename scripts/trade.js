/**
 * Loot Chests — Daggerheart: merchant trade
 * ---------------------------------------------------------------------------
 * Turns any chest Actor (a loot chest, a consumables shop…) into a merchant who
 * buys items from the players and sells them her own stock.
 *
 * - The GM marks a chest as a merchant ("for sale") and sets her prices: what
 *   she pays and what she charges, as a default per item type and Tier plus
 *   per-item prices. A chest without its own price list uses the world's
 *   default list, so freshly generated chests are ready to trade.
 * - On the trade counter a player drags items from their own sheet to sell and
 *   picks items from her stock to buy. Nothing moves while the deal is being
 *   put together.
 * - On confirmation the request goes to the active GM through a Foundry query
 *   (CONFIG.queries / User#query, v13+), because the player has no permission
 *   on the merchant Actor. The GM client checks everything again and moves the
 *   items both ways and only the difference in gold.
 *
 * Money is handled in "coins" internally: 1 handful = 10 coins, 1 bag = 10
 * handfuls, 1 chest = 10 bags (the Daggerheart conversion, with the optional
 * coins at 10 per handful).
 */

export const MODULE_ID = 'dh-lootbox';
const QUERY_NAME = `${MODULE_ID}.trade`;
const CONFIG_FLAG = 'merchant';
const DEFAULT_PRICES_SETTING = 'defaultPrices';

const SELLABLE_TYPES = ['weapon', 'armor', 'consumable', 'loot'];
const STACKABLE_TYPES = ['consumable', 'loot'];
const DENOMINATIONS = [
    ['chests', 1000],
    ['bags', 100],
    ['handfuls', 10],
    ['coins', 1]
];
const HANDFUL = 10;
const DEFAULT_CURRENCY_LABELS = { coins: 'Coins', handfuls: 'Handfuls', bags: 'Bags', chests: 'Chests' };
const QUERY_TIMEOUT = 30000;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const L = key => game.i18n.localize(`DHLOOTBOX.Trade.${key}`);
const F = (key, data) => game.i18n.format(`DHLOOTBOX.Trade.${key}`, data);
const getDragData = event => foundry.applications.ux.TextEditor.implementation.getDragEventData(event);

/* -------------------------------------------------------------------------- */
/*  Currency                                                                  */
/* -------------------------------------------------------------------------- */

function currencyConfig() {
    try {
        return game.settings.get('daggerheart', 'Homebrew')?.currency ?? null;
    } catch {
        return null;
    }
}

/** Denominations turned on in the system's Homebrew settings, largest first. */
function enabledDenominations() {
    const cfg = currencyConfig();
    const list = DENOMINATIONS.filter(([key]) => cfg?.[key]?.enabled ?? key !== 'coins');
    return list.length ? list : [['handfuls', HANDFUL]];
}

function smallestUnit() {
    const list = enabledDenominations();
    return list[list.length - 1][1];
}

function roundToUnit(base) {
    const unit = smallestUnit();
    return Math.max(0, Math.floor((Number(base) || 0) / unit) * unit);
}

function denominationLabel(key, count) {
    const custom = currencyConfig()?.[key]?.label;
    if (custom && custom !== DEFAULT_CURRENCY_LABELS[key]) return game.i18n.localize(custom);
    return L(`Currency.${key}.${count === 1 ? 'One' : 'Other'}`);
}

export function goldToBase(gold = {}) {
    return DENOMINATIONS.reduce((sum, [key, rate]) => sum + (Number(gold?.[key]) || 0) * rate, 0);
}

/** Splits an amount in coins into the enabled denominations (largest first). */
function splitBase(base) {
    const out = {};
    let rest = Math.max(0, Math.floor(base));
    for (const [key, rate] of enabledDenominations()) {
        out[key] = Math.floor(rest / rate);
        rest -= out[key] * rate;
    }
    return out;
}

export function formatMoney(base) {
    const parts = Object.entries(splitBase(base))
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${count} ${denominationLabel(key, count)}`);
    return parts.length ? parts.join(', ') : L('NoMoney');
}

/** Update data adding `base` coins to `gold`, in the enabled denominations. */
function addGold(gold, base) {
    return Object.fromEntries(
        Object.entries(splitBase(base)).map(([key, count]) => [`system.gold.${key}`, (Number(gold?.[key]) || 0) + count])
    );
}

/** Update data taking `cost` coins from `gold`: spends the smallest coins first and only
 *  breaks a larger one (giving change) when it has to. Null when the purse is too short. */
function payGold(gold, cost) {
    if (goldToBase(gold) < cost) return null;
    const purse = Object.fromEntries(DENOMINATIONS.map(([key]) => [key, Math.max(0, Number(gold?.[key]) || 0)]));
    const ascending = [...DENOMINATIONS].reverse();
    let due = cost;
    for (const [key, rate] of ascending) {
        const used = Math.min(purse[key], Math.floor(due / rate));
        purse[key] -= used;
        due -= used * rate;
    }
    if (due > 0) {
        // Every denomination left is now worth more than what is still due: break the smallest one.
        const [key, rate] = ascending.find(([k, r]) => purse[k] > 0 && r > due);
        purse[key] -= 1;
        for (const [changeKey, count] of Object.entries(splitBase(rate - due))) purse[changeKey] += count;
    }
    return Object.fromEntries(DENOMINATIONS.map(([key]) => [`system.gold.${key}`, purse[key]]));
}

/* -------------------------------------------------------------------------- */
/*  Merchant configuration                                                    */
/* -------------------------------------------------------------------------- */

export function isMerchant(actor) {
    return !!actor?.getFlag?.(MODULE_ID, 'isMerchant');
}

/** Whether the chest has a price list of its own (otherwise it uses the world's default). */
export function hasOwnPrices(actor) {
    return actor?.getFlag?.(MODULE_ID, CONFIG_FLAG) !== undefined;
}

function emptyGrid() {
    return Object.fromEntries(SELLABLE_TYPES.map(type => [type, [0, 0, 0, 0]]));
}

function readGrid(source) {
    const grid = emptyGrid();
    for (const type of SELLABLE_TYPES) {
        for (let i = 0; i < 4; i++) grid[type][i] = Math.max(0, Number(source?.[type]?.[i]) || 0);
    }
    return grid;
}

const nullablePrice = value =>
    value === null || value === undefined || value === '' ? null : Math.max(0, Number(value) || 0);

/** Normalizes a stored price list. Prices are in coins; `null` per-item prices fall back to the default. */
function normalizeConfig(raw = {}) {
    const overrides = (Array.isArray(raw.overrides) ? raw.overrides : Object.values(raw.overrides ?? {}))
        .filter(o => o?.name)
        .map(o => ({
            key: o.key ?? null,
            name: o.name,
            img: o.img ?? '',
            type: o.type ?? null,
            tier: Number(o.tier) || null,
            price: nullablePrice(o.price),
            sellPrice: nullablePrice(o.sellPrice)
        }));
    return {
        unlimitedPurse: !!raw.unlimitedPurse,
        purseUuid: typeof raw.purseUuid === 'string' && raw.purseUuid ? raw.purseUuid : null,
        defaults: readGrid(raw.defaults),
        sellDefaults: readGrid(raw.sellDefaults),
        overrides
    };
}

/**
 * Out-of-the-box price list, in coins, used until the GM saves a default list of their own.
 * Weapons and armor follow the core book's "Average Costs" table (ch. 3, "Your World's
 * Economy"): Tier 1 1–5 handfuls, Tier 2 1–2 bags, Tier 3 5–10 bags, Tier 4 1–2 chests —
 * she charges about the middle of each range. The book leaves treasure unpriced, so loot uses
 * the same scale and consumables (less powerful, handed out often) a cheaper one. She pays
 * players roughly half of what she charges.
 */
const BOOK_DEFAULT_PRICES = {
    unlimitedPurse: false,
    purseUuid: null,
    sellDefaults: {
        weapon: [30, 150, 750, 1500],
        armor: [30, 150, 750, 1500],
        loot: [30, 150, 750, 1500],
        consumable: [20, 50, 200, 500]
    },
    defaults: {
        weapon: [20, 80, 400, 800],
        armor: [20, 80, 400, 800],
        loot: [20, 80, 400, 800],
        consumable: [10, 30, 100, 250]
    },
    overrides: []
};

function worldDefaultPrices() {
    let stored = null;
    try {
        stored = game.settings.get(MODULE_ID, DEFAULT_PRICES_SETTING);
    } catch {
        /* setting not registered yet */
    }
    // Nothing saved yet (or an old empty value): start from the book's prices.
    return stored && stored.defaults ? stored : foundry.utils.deepClone(BOOK_DEFAULT_PRICES);
}

/** The merchant's price list: her own, or the world's default when she has none. */
export function getMerchantConfig(actor) {
    const own = actor?.getFlag?.(MODULE_ID, CONFIG_FLAG);
    return normalizeConfig(own ?? worldDefaultPrices());
}

/** The Actor whose gold pays for and receives the trades of `merchant`: the merchant's own chest
 *  when her price list names one (so chests for sale on the scene sell on her behalf), otherwise
 *  the chest itself. Null when the chest it names no longer exists. */
export function getPurse(merchant, config = getMerchantConfig(merchant)) {
    if (!config.purseUuid || config.purseUuid === merchant?.uuid) return merchant;
    return fromUuidSync(config.purseUuid) ?? null;
}

/** Flags/ownership that turn a new chest into a merchant (used when generating chests). */
export function merchantCreateData() {
    return {
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        flags: { isMerchant: true, ownershipBeforeMerchant: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    };
}

/** Turns a chest into a merchant (or back). Players get Observer access to a merchant:
 *  they can see the stock and trade at the counter, but not take or change anything. */
export async function setMerchant(actor, enabled) {
    if (!game.user.isGM) return;
    const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    if (enabled) {
        const update = { [`flags.${MODULE_ID}.isMerchant`]: true, 'ownership.default': OBSERVER };
        if (actor.getFlag(MODULE_ID, 'ownershipBeforeMerchant') === undefined) {
            update[`flags.${MODULE_ID}.ownershipBeforeMerchant`] = actor.ownership.default ?? OBSERVER;
        }
        await actor.update(update);
        ui.notifications.info(F('MerchantEnabled', { name: actor.name }));
    } else {
        const previous = actor.getFlag(MODULE_ID, 'ownershipBeforeMerchant');
        const update = {
            [`flags.${MODULE_ID}.isMerchant`]: false,
            [`flags.${MODULE_ID}.-=ownershipBeforeMerchant`]: null
        };
        if (previous !== undefined) update['ownership.default'] = previous;
        await actor.update(update);
        ui.notifications.info(F('MerchantDisabled', { name: actor.name }));
    }
}

/* -------------------------------------------------------------------------- */
/*  Items and prices                                                          */
/* -------------------------------------------------------------------------- */

function normalName(name) {
    return String(name ?? '').trim().toLocaleLowerCase();
}

function itemSource(item) {
    return item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? null;
}

/** Quantity owned (items without a quantity field count as one). */
function itemQuantity(item) {
    const quantity = item?.system?.quantity;
    return typeof quantity === 'number' ? quantity : 1;
}

/** Why a player's item can't be sold, or null. */
function sellProblem(item) {
    if (!SELLABLE_TYPES.includes(item?.type)) return 'NotSellable';
    if (item.system?.equipped) return 'Equipped';
    if (itemQuantity(item) < 1) return 'NoneLeft';
    return null;
}

/** Why an item of the merchant's stock can't be bought, or null. */
function stockProblem(item) {
    if (!SELLABLE_TYPES.includes(item?.type)) return 'NotSellable';
    if (itemQuantity(item) < 1) return 'NoneLeft';
    return null;
}

/** Rarity of consumables and loot comes from their range in the system's "Loot" and
 *  "Consumables" tables: 1–12 Common (Tier 1), 13–24 Uncommon, 25–36 Rare, 37+ Legendary. */
let rarityIndex = null;
async function loadRarityIndex() {
    if (rarityIndex) return rarityIndex;
    const index = { byUuid: new Map(), byName: new Map() };
    try {
        const pack = game.packs.get('daggerheart.rolltables');
        const entries = pack ? await pack.getIndex() : [];
        for (const tableName of ['Loot', 'Consumables']) {
            const entry = entries.find(e => e.name === tableName);
            if (!entry) continue;
            const table = await pack.getDocument(entry._id);
            for (const result of table?.results ?? []) {
                const low = Number(result.range?.[0]);
                if (!Number.isFinite(low)) continue;
                const tier = Math.min(4, Math.max(1, Math.ceil(low / 12)));
                if (result.documentUuid) index.byUuid.set(result.documentUuid, tier);
                const label = result.name ?? result.text;
                if (label) index.byName.set(normalName(label), tier);
            }
        }
    } catch (err) {
        console.warn(`${MODULE_ID} | Could not read the rarity tables`, err);
    }
    rarityIndex = index;
    return index;
}

function itemTier(item, rarity) {
    const tier = Number(item.system?.tier);
    if (Number.isFinite(tier) && tier >= 1) return Math.min(4, Math.floor(tier));
    const source = itemSource(item);
    return (source && rarity.byUuid.get(source)) || rarity.byName.get(normalName(item.name)) || 1;
}

function findOverride(config, item) {
    const source = itemSource(item);
    const name = normalName(item.name);
    return (
        (source && config.overrides.find(o => o.key === source)) ||
        config.overrides.find(o => normalName(o.name) === name) ||
        null
    );
}

/** Price of one unit, in coins. `side` is "offer" (what she pays a player) or "ask"
 *  (what she charges a player). 0 means she doesn't trade that item that way. */
async function priceFor(item, side, config) {
    if (!SELLABLE_TYPES.includes(item?.type)) return 0;
    const field = side === 'ask' ? 'sellPrice' : 'price';
    const override = findOverride(config, item);
    if (override && override[field] !== null) return roundToUnit(override[field]);
    const rarity = await loadRarityIndex();
    const grid = side === 'ask' ? config.sellDefaults : config.defaults;
    return roundToUnit(grid[item.type][itemTier(item, rarity) - 1]);
}

/** What the merchant pays for one unit of a player's item, in coins (0 = she doesn't buy it). */
export function unitPrice(merchant, item, config = getMerchantConfig(merchant)) {
    return priceFor(item, 'offer', config);
}

/** What the merchant charges for one unit of her stock, in coins (0 = not for sale). */
export function askPrice(merchant, item, config = getMerchantConfig(merchant)) {
    return priceFor(item, 'ask', config);
}

/* -------------------------------------------------------------------------- */
/*  The trade, run on the GM's client                                         */
/* -------------------------------------------------------------------------- */

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/** One trade at a time, so two players can't both spend the same purse or stock. */
let tradeQueue = Promise.resolve();
function enqueue(task) {
    const run = tradeQueue.then(task, task);
    tradeQueue = run.catch(() => {});
    return run;
}

async function handleTradeQuery(data) {
    if (!game.user.isGM) return fail('NotGM');
    return enqueue(() => executeTrade(data));
}

/** Sums the requested quantity per item id. */
function wantedQuantities(lines) {
    const wanted = new Map();
    for (const line of Array.isArray(lines) ? lines : []) {
        const quantity = Math.max(1, Math.floor(Number(line?.quantity) || 1));
        if (line?.itemId) wanted.set(line.itemId, (wanted.get(line.itemId) ?? 0) + quantity);
    }
    return wanted;
}

/** Item changes for one actor, applied in one go once the whole trade is checked. */
function newPlan(actor) {
    return { actor, deltas: new Map(), creates: [], pending: new Map() };
}

function planGive(plan, item, quantity) {
    plan.deltas.set(item.id, (plan.deltas.get(item.id) ?? 0) - quantity);
}

/** Adds `quantity` of `item` to the plan's actor, stacking consumables/loot with what it has. */
function planReceive(plan, item, quantity) {
    const data = item.toObject();
    delete data._id;
    if (data.system && 'equipped' in data.system) data.system.equipped = false;
    const stackable = STACKABLE_TYPES.includes(item.type) && typeof item.system?.quantity === 'number';
    if (!stackable) {
        for (let i = 0; i < quantity; i++) {
            const copy = foundry.utils.deepClone(data);
            if (copy.system && 'quantity' in copy.system) copy.system.quantity = 1;
            plan.creates.push(copy);
        }
        return;
    }
    const key = `${item.type}|${normalName(item.name)}`;
    const existing = plan.actor.items.find(i => i.type === item.type && normalName(i.name) === normalName(item.name));
    if (existing) {
        plan.deltas.set(existing.id, (plan.deltas.get(existing.id) ?? 0) + quantity);
    } else if (plan.pending.has(key)) {
        plan.pending.get(key).system.quantity += quantity;
    } else {
        data.system.quantity = quantity;
        plan.pending.set(key, data);
        plan.creates.push(data);
    }
}

async function applyPlan(plan) {
    const updates = [];
    const deletes = [];
    for (const [id, delta] of plan.deltas) {
        const item = plan.actor.items.get(id);
        if (!item || !delta) continue;
        const final = itemQuantity(item) + delta;
        if (final <= 0) deletes.push(id);
        else updates.push({ _id: id, 'system.quantity': final });
    }
    if (plan.creates.length) await plan.actor.createEmbeddedDocuments('Item', plan.creates);
    if (updates.length) await plan.actor.updateEmbeddedDocuments('Item', updates);
    if (deletes.length) await plan.actor.deleteEmbeddedDocuments('Item', deletes);
}

async function executeTrade({ userId, merchantUuid, customerUuid, sell, buy } = {}) {
    const user = game.users.get(userId);
    const merchant = merchantUuid ? await fromUuid(merchantUuid) : null;
    const customer = customerUuid ? await fromUuid(customerUuid) : null;
    if (!user || !merchant || !customer || merchant.uuid === customer.uuid) return fail('Missing');
    if (!isMerchant(merchant)) return fail('NotMerchant');
    if (!customer.testUserPermission(user, 'OWNER')) return fail('NotOwner');

    const config = getMerchantConfig(merchant);
    const refused = [];

    // What the player sells to her.
    const sold = [];
    for (const [itemId, requested] of wantedQuantities(sell)) {
        const item = customer.items.get(itemId);
        if (!item) continue;
        const unit = sellProblem(item) ? 0 : await unitPrice(merchant, item, config);
        if (unit <= 0) {
            refused.push(item.name);
            continue;
        }
        const quantity = Math.min(itemQuantity(item), requested);
        sold.push({ item, quantity, subtotal: unit * quantity });
    }

    // What the player buys from her stock.
    const bought = [];
    for (const [itemId, requested] of wantedQuantities(buy)) {
        const item = merchant.items.get(itemId);
        if (!item) continue;
        const unit = stockProblem(item) ? 0 : await askPrice(merchant, item, config);
        if (unit <= 0) {
            refused.push(item.name);
            continue;
        }
        const quantity = Math.min(itemQuantity(item), requested);
        bought.push({ item, quantity, subtotal: unit * quantity });
    }
    if (!sold.length && !bought.length) return fail('NothingToTrade', { refused });

    const paid = sold.reduce((sum, line) => sum + line.subtotal, 0);
    const charged = bought.reduce((sum, line) => sum + line.subtotal, 0);
    const net = paid - charged; // > 0: she pays the player; < 0: the player pays her

    // The gold moves between the player and the merchant's purse, which may be another chest.
    const purse = getPurse(merchant, config);
    if (!purse) return fail('PurseMissing');
    if (purse.uuid === customer.uuid) return fail('Missing');

    let customerGold = {};
    let purseGold = {};
    if (net > 0) {
        customerGold = addGold(customer.system?.gold, net);
        if (!config.unlimitedPurse) {
            purseGold = payGold(purse.system?.gold, net);
            if (!purseGold) return fail('MerchantBroke', { total: net });
        }
    } else if (net < 0) {
        customerGold = payGold(customer.system?.gold, -net);
        if (!customerGold) return fail('CustomerBroke', { total: -net, name: customer.name });
        if (!config.unlimitedPurse) purseGold = addGold(purse.system?.gold, -net);
    }

    const merchantPlan = newPlan(merchant);
    const customerPlan = newPlan(customer);
    for (const line of sold) {
        planGive(customerPlan, line.item, line.quantity);
        planReceive(merchantPlan, line.item, line.quantity);
    }
    for (const line of bought) {
        planGive(merchantPlan, line.item, line.quantity);
        planReceive(customerPlan, line.item, line.quantity);
    }

    try {
        await applyPlan(merchantPlan);
        await applyPlan(customerPlan);
        if (Object.keys(customerGold).length) await customer.update(customerGold);
        if (Object.keys(purseGold).length) await purse.update(purseGold);
    } catch (err) {
        console.error(`${MODULE_ID} | Trade failed`, err);
        return fail('Failed', { error: err.message });
    }

    await postTradeMessage({ user, merchant, purse, customer, sold, bought, refused, net });
    return {
        ok: true,
        purseName: purse.name,
        net,
        paid,
        charged,
        sold: sold.map(l => ({ name: l.item.name, quantity: l.quantity })),
        bought: bought.map(l => ({ name: l.item.name, quantity: l.quantity })),
        refused
    };
}

async function postTradeMessage({ user, merchant, purse, customer, sold, bought, refused, net }) {
    const esc = foundry.utils.escapeHTML;
    const list = lines =>
        lines
            .map(l => `<li>${F('Chat.Line', { quantity: l.quantity, name: esc(l.item.name), subtotal: formatMoney(l.subtotal) })}</li>`)
            .join('');
    const names = { merchant: esc(merchant.name), customer: esc(customer.name) };
    const payer = { ...names, merchant: esc(purse.name) };
    const balance =
        net > 0
            ? F('Chat.ToCustomer', { ...payer, total: formatMoney(net) })
            : net < 0
            ? F('Chat.ToMerchant', { ...payer, total: formatMoney(-net) })
            : L('Chat.Even');
    const content = `
        <div class="dh-lootbox-sale">
            <h3>${F('Chat.Title', { merchant: names.merchant })}</h3>
            ${sold.length ? `<p><strong>${F('Chat.Sold', names)}</strong></p><ul>${list(sold)}</ul>` : ''}
            ${bought.length ? `<p><strong>${F('Chat.Bought', names)}</strong></p><ul>${list(bought)}</ul>` : ''}
            <p><strong>${balance}</strong></p>
            ${refused.length ? `<p class="hint">${F('Chat.Refused', { names: refused.map(esc).join(', ') })}</p>` : ''}
        </div>`;
    const whisper = new Set(ChatMessage.getWhisperRecipients('GM').map(u => u.id));
    whisper.add(user.id);
    await ChatMessage.create({ content, whisper: [...whisper], speaker: { alias: merchant.name } });
}

/** Sends the trade to the active GM and waits for the answer. */
async function requestTrade(merchant, customer, sell, buy) {
    const payload = { userId: game.user.id, merchantUuid: merchant.uuid, customerUuid: customer.uuid, sell, buy };
    const gm = game.users.activeGM;
    if (!gm) return fail('NoGM');
    if (gm.isSelf) return handleTradeQuery(payload);
    try {
        return await gm.query(QUERY_NAME, payload, { timeout: QUERY_TIMEOUT });
    } catch (err) {
        console.error(`${MODULE_ID} | Trade query failed`, err);
        return fail('Timeout');
    }
}

function errorMessage(result) {
    const key = `DHLOOTBOX.Trade.Errors.${result?.reason ?? 'Failed'}`;
    const data = {
        total: result?.total !== undefined ? formatMoney(result.total) : '',
        name: result?.name ?? '',
        names: (result?.refused ?? []).join(', '),
        error: result?.error ?? ''
    };
    return game.i18n.has(key) ? game.i18n.format(key, data) : L('Errors.Failed');
}

/* -------------------------------------------------------------------------- */
/*  Trade counter (player window)                                             */
/* -------------------------------------------------------------------------- */

const appId = (prefix, actor) => `${prefix}-${actor ? actor.uuid.replace(/\./g, '-') : 'world'}`;

export class TradeCounter extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        classes: ['dh-lootbox-trade'],
        window: { icon: 'fa-solid fa-scale-balanced', resizable: true },
        position: { width: 520, height: 'auto' },
        actions: {
            addBuy: TradeCounter.#onAddBuy,
            removeLine: TradeCounter.#onRemoveLine,
            clear: TradeCounter.#onClear,
            confirm: TradeCounter.#onConfirm
        }
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/trade-counter.hbs`,
            templates: [
                `modules/${MODULE_ID}/templates/trade-counter.hbs`,
                `modules/${MODULE_ID}/templates/trade-line.hbs`
            ]
        }
    };

    static #instances = new Map();

    /** Opens (or brings forward) the counter of a merchant, optionally putting an item up for sale. */
    static async open(merchant, { item } = {}) {
        if (!isMerchant(merchant)) return null;
        let app = TradeCounter.#instances.get(merchant.uuid);
        if (!app) {
            app = new TradeCounter({ merchant });
            TradeCounter.#instances.set(merchant.uuid, app);
        }
        if (item) await app.stage(item, { render: false });
        await app.render({ force: true });
        app.bringToFront?.();
        return app;
    }

    constructor({ merchant, ...options } = {}) {
        super({ id: appId('dh-lootbox-trade', merchant), ...options });
        this.merchant = merchant;
        this.customer = TradeCounter.#defaultCustomer();
        /** @type {Map<string, number>} customer item id → quantity offered to her */
        this.sellLines = new Map();
        /** @type {Map<string, number>} merchant item id → quantity the customer wants */
        this.buyLines = new Map();
        this.busy = false;
        this.hookIds = [];
    }

    /** Characters the current user can trade for. */
    static #ownedCharacters() {
        return game.actors.filter(a => a.type === 'character' && a.isOwner);
    }

    static #defaultCustomer() {
        const character = game.user.character;
        if (character?.isOwner) return character;
        const owned = game.user.isGM ? [] : TradeCounter.#ownedCharacters();
        return owned.length === 1 ? owned[0] : null;
    }

    get title() {
        return F('CounterTitle', { name: this.merchant.name });
    }

    #setCustomer(actor) {
        if (this.customer?.uuid === actor?.uuid) return;
        if (this.sellLines.size) {
            this.sellLines.clear();
            ui.notifications.info(F('CustomerChanged', { name: actor?.name ?? '' }));
        }
        this.customer = actor;
    }

    /** Puts an item from the player's sheet up for sale. Nothing leaves the sheet yet. */
    async stage(item, { render = true } = {}) {
        const actor = item?.actor;
        if (!item || !actor) return ui.notifications.warn(L('Warn.DropFromSheet'));
        if (actor.uuid === this.merchant.uuid) return;
        if (!actor.isOwner) return ui.notifications.warn(L('Warn.NotYourItem'));
        if (!SELLABLE_TYPES.includes(item.type)) return ui.notifications.warn(F('Warn.NotSellable', { name: item.name }));
        if (this.customer && this.customer.uuid !== actor.uuid && this.sellLines.size) {
            return ui.notifications.warn(F('Warn.OneSeller', { name: this.customer.name }));
        }
        this.#setCustomer(actor);
        const current = this.sellLines.get(item.id) ?? 0;
        this.sellLines.set(item.id, Math.min(itemQuantity(item), current + 1) || 1);
        if (render) this.render();
    }

    /** Builds the display rows for one side of the deal and returns their total. */
    async #lines(map, owner, priceOf, problemOf, side) {
        const rows = [];
        let total = 0;
        for (const [itemId, wanted] of [...map]) {
            const item = owner?.items.get(itemId);
            if (!item) {
                map.delete(itemId);
                continue;
            }
            const max = Math.max(1, itemQuantity(item));
            const quantity = Math.min(Math.max(1, wanted), max);
            map.set(itemId, quantity);
            const problem = problemOf(item);
            const unit = problem ? 0 : await priceOf(item);
            const refused = unit <= 0;
            const subtotal = refused ? 0 : unit * quantity;
            total += subtotal;
            rows.push({
                id: itemId,
                side,
                name: item.name,
                img: item.img,
                quantity,
                max,
                quantifiable: max > 1,
                quantityLabel: F('QuantityLabel', { name: item.name }),
                refused,
                priceLabel: refused
                    ? L(problem ? `Problem.${problem}` : side === 'sell' ? 'WontBuy' : 'NotForSale')
                    : quantity > 1
                    ? F('PriceEach', { total: formatMoney(subtotal), each: formatMoney(unit) })
                    : formatMoney(unit)
            });
        }
        return { rows, total };
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const config = getMerchantConfig(this.merchant);
        const merchant = this.merchant;

        const sell = await this.#lines(
            this.sellLines,
            this.customer,
            item => unitPrice(merchant, item, config),
            sellProblem,
            'sell'
        );
        const buy = await this.#lines(
            this.buyLines,
            merchant,
            item => askPrice(merchant, item, config),
            stockProblem,
            'buy'
        );

        const stock = [];
        for (const item of merchant.items) {
            if (!SELLABLE_TYPES.includes(item.type)) continue;
            const quantity = itemQuantity(item);
            const unit = stockProblem(item) ? 0 : await askPrice(merchant, item, config);
            const inCart = this.buyLines.get(item.id) ?? 0;
            stock.push({
                id: item.id,
                name: item.name,
                img: item.img,
                quantity,
                forSale: unit > 0,
                priceLabel: unit > 0 ? formatMoney(unit) : L('NotForSale'),
                canAdd: unit > 0 && inCart < quantity,
                addLabel: F('AddToCart', { name: item.name })
            });
        }
        stock.sort((a, b) => Number(b.forSale) - Number(a.forSale) || a.name.localeCompare(b.name, game.i18n.lang));

        const net = sell.total - buy.total;
        const purse = getPurse(merchant, config);
        const purseMissing = !purse;
        const merchantBroke = !!purse && net > 0 && !config.unlimitedPurse && net > goldToBase(purse.system?.gold);
        const customerBroke = net < 0 && !!this.customer && -net > goldToBase(this.customer.system?.gold);
        const hasGM = !!game.users.activeGM;

        const characters = TradeCounter.#ownedCharacters();
        if (this.customer && !characters.some(a => a.uuid === this.customer.uuid)) characters.unshift(this.customer);

        return Object.assign(context, {
            merchant: { name: merchant.name, img: merchant.img },
            customers: characters.map(a => ({ uuid: a.uuid, name: a.name, selected: a.uuid === this.customer?.uuid })),
            customer: this.customer ? { name: this.customer.name } : null,
            sellLines: sell.rows,
            buyLines: buy.rows,
            stock,
            hasLines: sell.rows.length > 0 || buy.rows.length > 0,
            paidLabel: formatMoney(sell.total),
            chargedLabel: formatMoney(buy.total),
            balanceLabel:
                net > 0
                    ? F('BalanceReceive', { total: formatMoney(net) })
                    : net < 0
                    ? F('BalancePay', { total: formatMoney(-net) })
                    : L('BalanceEven'),
            merchantBroke,
            purseMissing,
            customerBroke,
            noCustomer: !this.customer,
            hasGM,
            busy: this.busy,
            canConfirm:
                sell.total + buy.total > 0 &&
                !!this.customer &&
                !purseMissing &&
                !merchantBroke &&
                !customerBroke &&
                hasGM &&
                !this.busy
        });
    }

    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        this.element.addEventListener('dragover', event => event.preventDefault());
        this.element.addEventListener('drop', event => this.#onDrop(event));

        const relevant = actor =>
            actor && [this.customer?.uuid, this.merchant.uuid, getPurse(this.merchant)?.uuid].includes(actor.uuid);
        const rerender = () => this.rendered && this.render();
        const onItem = item => relevant(item.parent) && rerender();
        this.hookIds = [
            ['updateActor', Hooks.on('updateActor', actor => relevant(actor) && rerender())],
            ['createItem', Hooks.on('createItem', onItem)],
            ['updateItem', Hooks.on('updateItem', onItem)],
            ['deleteItem', Hooks.on('deleteItem', onItem)],
            ['userConnected', Hooks.on('userConnected', rerender)]
        ];
    }

    _onRender(context, options) {
        super._onRender(context, options);
        for (const input of this.element.querySelectorAll('input[name="quantity"]')) {
            input.addEventListener('change', () => {
                const map = input.dataset.side === 'buy' ? this.buyLines : this.sellLines;
                map.set(input.dataset.itemId, Math.max(1, Math.floor(Number(input.value) || 1)));
                this.render();
            });
        }
        this.element.querySelector('select[name="customer"]')?.addEventListener('change', async event => {
            const actor = event.currentTarget.value ? await fromUuid(event.currentTarget.value) : null;
            this.#setCustomer(actor);
            this.render();
        });
    }

    _onClose(options) {
        super._onClose(options);
        for (const [hook, id] of this.hookIds) Hooks.off(hook, id);
        this.hookIds = [];
        TradeCounter.#instances.delete(this.merchant.uuid);
    }

    async #onDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        const data = getDragData(event);
        if (data?.type !== 'Item' || !data.uuid) return;
        const item = await fromUuid(data.uuid);
        await this.stage(item);
    }

    static #onAddBuy(_event, target) {
        const item = this.merchant.items.get(target.dataset.itemId);
        if (!item) return;
        const current = this.buyLines.get(item.id) ?? 0;
        this.buyLines.set(item.id, Math.min(itemQuantity(item), current + 1) || 1);
        this.render();
    }

    static #onRemoveLine(_event, target) {
        const map = target.dataset.side === 'buy' ? this.buyLines : this.sellLines;
        map.delete(target.dataset.itemId);
        this.render();
    }

    static #onClear() {
        this.sellLines.clear();
        this.buyLines.clear();
        this.render();
    }

    static async #onConfirm() {
        if (this.busy || !this.customer || !(this.sellLines.size || this.buyLines.size)) return;
        const toLines = map => [...map].map(([itemId, quantity]) => ({ itemId, quantity }));
        this.busy = true;
        await this.render();
        const result = await requestTrade(this.merchant, this.customer, toLines(this.sellLines), toLines(this.buyLines));
        this.busy = false;
        if (result?.ok) {
            const names = { merchant: result.purseName ?? this.merchant.name, customer: this.customer.name };
            ui.notifications.info(
                result.net > 0
                    ? F('DoneReceived', { ...names, total: formatMoney(result.net) })
                    : result.net < 0
                    ? F('DonePaid', { ...names, total: formatMoney(-result.net) })
                    : F('DoneEven', names)
            );
            this.sellLines.clear();
            this.buyLines.clear();
            await this.close();
        } else {
            ui.notifications.warn(errorMessage(result));
            if (this.rendered) this.render();
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Price list (GM window): a chest's own list or the world's default          */
/* -------------------------------------------------------------------------- */

export class PriceTable extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        tag: 'form',
        classes: ['dh-lootbox-prices'],
        window: { icon: 'fa-solid fa-tags', resizable: true },
        position: { width: 640, height: 'auto' },
        form: { handler: PriceTable.#onSubmit, closeOnSubmit: true },
        actions: {
            removeOverride: PriceTable.#onRemoveOverride,
            fillFromStock: PriceTable.#onFillFromStock,
            useDefault: PriceTable.#onUseDefault,
            bookPrices: PriceTable.#onBookPrices,
            editDefault: PriceTable.#onEditDefault
        }
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/price-table.hbs`,
            templates: [
                `modules/${MODULE_ID}/templates/price-table.hbs`,
                `modules/${MODULE_ID}/templates/price-grid.hbs`
            ]
        }
    };

    /** Opens the price list of `merchant`, or the world's default list when `merchant` is null. */
    static open(merchant = null) {
        if (!game.user.isGM) return null;
        const existing = foundry.applications.instances?.get(appId('dh-lootbox-prices', merchant));
        if (existing) {
            existing.render({ force: true });
            existing.bringToFront?.();
            return existing;
        }
        const app = new PriceTable({ merchant });
        app.render({ force: true });
        return app;
    }

    constructor({ merchant = null, ...options } = {}) {
        super({ id: appId('dh-lootbox-prices', merchant), ...options });
        this.merchant = merchant;
        this.draft = merchant ? getMerchantConfig(merchant) : normalizeConfig(worldDefaultPrices());
    }

    get title() {
        return this.merchant ? F('Prices.Title', { name: this.merchant.name }) : L('Prices.DefaultTitle');
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const step = smallestUnit() / HANDFUL;
        const toInput = base => (base === null ? '' : Math.round((base / HANDFUL) * 10) / 10);
        const coinsOn = enabledDenominations().some(([key]) => key === 'coins');
        const grid = (source, name) =>
            SELLABLE_TYPES.map(type => {
                const label = L(`Category.${type}`);
                return {
                    type,
                    label,
                    cells: source[type].map((base, index) => ({
                        index,
                        grid: name,
                        value: toInput(base),
                        aria: `${label} — ${F('Prices.Tier', { tier: index + 1 })}`
                    }))
                };
            });
        const defaultFor = (source, o) =>
            o.type && SELLABLE_TYPES.includes(o.type) ? toInput(source[o.type][(o.tier || 1) - 1]) : L('Prices.DefaultPlaceholder');
        return Object.assign(context, {
            isWorld: !this.merchant,
            usesDefault: !!this.merchant && !hasOwnPrices(this.merchant),
            hasOwn: !!this.merchant && hasOwnPrices(this.merchant),
            unlimitedPurse: this.draft.unlimitedPurse,
            purseOptions: this.#purseOptions(),
            step,
            unitHint: coinsOn ? L('Prices.UnitHintCoins') : L('Prices.UnitHint'),
            tiers: [1, 2, 3, 4].map(tier => F('Prices.Tier', { tier })),
            buyGrid: grid(this.draft.defaults, 'defaults'),
            sellGrid: grid(this.draft.sellDefaults, 'sellDefaults'),
            overrides: this.draft.overrides.map((o, index) => ({
                index,
                name: o.name,
                img: o.img,
                price: toInput(o.price),
                sellPrice: toInput(o.sellPrice),
                pricePlaceholder: defaultFor(this.draft.defaults, o),
                sellPlaceholder: defaultFor(this.draft.sellDefaults, o),
                payLabel: F('Prices.PaysFor', { name: o.name }),
                chargeLabel: F('Prices.ChargesFor', { name: o.name })
            }))
        });
    }

    /** Chests that can hold the gold: every other chest of this module. */
    #purseOptions() {
        const chests = game.actors
            .filter(a => a.uuid !== this.merchant?.uuid && (a.getFlag(MODULE_ID, 'isChest') || isMerchant(a)))
            .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
            .map(a => ({ uuid: a.uuid, name: a.name, selected: a.uuid === this.draft.purseUuid }));
        if (this.draft.purseUuid && !chests.some(c => c.selected) && this.draft.purseUuid !== this.merchant?.uuid) {
            chests.unshift({ uuid: this.draft.purseUuid, name: L('Prices.PurseGone'), selected: true });
        }
        return chests;
    }

    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        this.element.addEventListener('dragover', event => event.preventDefault());
        this.element.addEventListener('drop', event => this.#onDrop(event));
    }

    _onRender(context, options) {
        super._onRender(context, options);
        this.element.querySelector('select[name="purseUuid"]')?.addEventListener('change', event => {
            this.draft.purseUuid = event.currentTarget.value || null;
        });
        const toBase = input => Math.max(0, Math.round((Number(input.value) || 0) * HANDFUL));
        this.element.querySelector('[name="unlimitedPurse"]')?.addEventListener('change', event => {
            this.draft.unlimitedPurse = event.currentTarget.checked;
        });
        for (const input of this.element.querySelectorAll('input[data-grid]')) {
            input.addEventListener('input', () => {
                this.draft[input.dataset.grid][input.dataset.defaultType][Number(input.dataset.tierIndex)] = toBase(input);
            });
        }
        for (const input of this.element.querySelectorAll('input[data-override-index]')) {
            input.addEventListener('input', () => {
                const override = this.draft.overrides[Number(input.dataset.overrideIndex)];
                if (override) override[input.dataset.field] = input.value === '' ? null : toBase(input);
            });
        }
    }

    /** Adds an item to the per-item list; empty prices follow the defaults until filled in. */
    async #addOverride(item, { quiet = false } = {}) {
        if (!SELLABLE_TYPES.includes(item?.type)) {
            if (!quiet) ui.notifications.warn(F('Warn.NotSellable', { name: item?.name ?? '?' }));
            return false;
        }
        const key = item.pack ? item.uuid : itemSource(item);
        if (findOverride(this.draft, item) || (key && this.draft.overrides.some(o => o.key === key))) {
            if (!quiet) ui.notifications.info(F('Prices.AlreadyListed', { name: item.name }));
            return false;
        }
        const tier = itemTier(item, await loadRarityIndex());
        this.draft.overrides.push({ key, name: item.name, img: item.img, type: item.type, tier, price: null, sellPrice: null });
        return true;
    }

    async #onDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        const data = getDragData(event);
        if (data?.type !== 'Item' || !data.uuid) return;
        const item = await fromUuid(data.uuid);
        if (await this.#addOverride(item)) this.render();
    }

    static #onRemoveOverride(_event, target) {
        this.draft.overrides.splice(Number(target.dataset.index), 1);
        this.render();
    }

    static async #onFillFromStock() {
        if (!this.merchant) return;
        let added = 0;
        for (const item of this.merchant.items) {
            if (await this.#addOverride(item, { quiet: true })) added++;
        }
        ui.notifications.info(F('Prices.Filled', { count: added }));
        this.render();
    }

    /** Drops the chest's own list so it follows the world's default again. */
    static async #onUseDefault() {
        if (!this.merchant) return;
        await this.merchant.update({ [`flags.${MODULE_ID}.-=${CONFIG_FLAG}`]: null });
        ui.notifications.info(F('Prices.UsingDefault', { name: this.merchant.name }));
        await this.close();
    }

    /** Refills both grids with the core book's prices (kept per-item prices and purse untouched).
     *  Nothing is stored until the list is saved. */
    static #onBookPrices() {
        this.draft.defaults = readGrid(BOOK_DEFAULT_PRICES.defaults);
        this.draft.sellDefaults = readGrid(BOOK_DEFAULT_PRICES.sellDefaults);
        ui.notifications.info(L('Prices.BookPricesApplied'));
        this.render();
    }

    static #onEditDefault() {
        PriceTable.open(null);
    }

    static async #onSubmit() {
        const data = foundry.utils.deepClone(this.draft);
        if (this.merchant) {
            await this.merchant.update({ [`flags.${MODULE_ID}.${CONFIG_FLAG}`]: data });
            ui.notifications.info(F('Prices.Saved', { name: this.merchant.name }));
        } else {
            await game.settings.set(MODULE_ID, DEFAULT_PRICES_SETTING, data);
            ui.notifications.info(L('Prices.DefaultSaved'));
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                              */
/* -------------------------------------------------------------------------- */

export function registerTrade() {
    game.settings.register(MODULE_ID, DEFAULT_PRICES_SETTING, {
        scope: 'world',
        config: false,
        type: Object,
        default: {}
    });
    CONFIG.queries[QUERY_NAME] = handleTradeQuery;
}

export const tradeApi = {
    setMerchant,
    getPurse,
    isMerchant,
    getMerchantConfig,
    unitPrice,
    askPrice,
    formatMoney,
    openTradeCounter: (merchant, options) => TradeCounter.open(merchant, options),
    openPriceTable: merchant => PriceTable.open(merchant ?? null),
    openDefaultPriceTable: () => PriceTable.open(null)
};
