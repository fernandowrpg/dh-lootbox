/**
 * Loot Chests — Daggerheart: merchant trade
 * ---------------------------------------------------------------------------
 * Turns a chest Actor into a merchant that buys items from the players.
 *
 * - The GM marks a chest as a merchant and sets what she pays per item (a
 *   default per item type and Tier, plus per-item prices).
 * - A player drags items from their own sheet onto the merchant (or onto the
 *   trade counter window). The items stay on the sheet while the offer is
 *   being put together.
 * - On confirmation the request goes to the active GM through a Foundry query
 *   (CONFIG.queries / User#query, v13+). The GM client checks everything again
 *   and moves the items to the merchant and the gold to the player in one go,
 *   because the player has no permission to change the merchant Actor.
 *
 * Money is handled in "coins" internally: 1 handful = 10 coins, 1 bag = 10
 * handfuls, 1 chest = 10 bags (the Daggerheart conversion, with the optional
 * coins at 10 per handful).
 */

export const MODULE_ID = 'dh-lootbox';
const QUERY_NAME = `${MODULE_ID}.sell`;
const CONFIG_FLAG = 'merchant';

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

/* -------------------------------------------------------------------------- */
/*  Merchant configuration                                                    */
/* -------------------------------------------------------------------------- */

export function isMerchant(actor) {
    return !!actor?.getFlag?.(MODULE_ID, 'isMerchant');
}

function emptyDefaults() {
    return Object.fromEntries(SELLABLE_TYPES.map(type => [type, [0, 0, 0, 0]]));
}

/** Prices are stored in coins. `overrides` match an item by compendium source or by name. */
export function getMerchantConfig(actor) {
    const raw = actor?.getFlag?.(MODULE_ID, CONFIG_FLAG) ?? {};
    const defaults = emptyDefaults();
    for (const type of SELLABLE_TYPES) {
        for (let i = 0; i < 4; i++) defaults[type][i] = Math.max(0, Number(raw.defaults?.[type]?.[i]) || 0);
    }
    const overrides = (Array.isArray(raw.overrides) ? raw.overrides : Object.values(raw.overrides ?? {}))
        .filter(o => o?.name)
        .map(o => ({ key: o.key ?? null, name: o.name, img: o.img ?? '', price: Math.max(0, Number(o.price) || 0) }));
    return { unlimitedPurse: !!raw.unlimitedPurse, defaults, overrides };
}

/** Turns a chest into a merchant (or back). Players get Observer access to a merchant:
 *  they can see the stock and drop items to sell, but not take or change anything. */
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

/** Why an item can't be sold, or null. */
function sellProblem(item) {
    if (!SELLABLE_TYPES.includes(item?.type)) return 'NotSellable';
    if (item.system?.equipped) return 'Equipped';
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

/** What the merchant pays for one unit of `item`, in coins (0 = she doesn't buy it). */
export async function unitPrice(merchant, item, config = getMerchantConfig(merchant)) {
    if (!SELLABLE_TYPES.includes(item?.type)) return 0;
    const override = findOverride(config, item);
    if (override) return roundToUnit(override.price);
    const rarity = await loadRarityIndex();
    return roundToUnit(config.defaults[item.type][itemTier(item, rarity) - 1]);
}

/* -------------------------------------------------------------------------- */
/*  The sale, run on the GM's client                                          */
/* -------------------------------------------------------------------------- */

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/** One sale at a time, so two players can't both spend the same purse. */
let saleQueue = Promise.resolve();
function enqueue(task) {
    const run = saleQueue.then(task, task);
    saleQueue = run.catch(() => {});
    return run;
}

async function handleSellQuery(data) {
    if (!game.user.isGM) return fail('NotGM');
    return enqueue(() => executeSale(data));
}

async function executeSale({ userId, merchantUuid, sellerUuid, lines } = {}) {
    const user = game.users.get(userId);
    const merchant = merchantUuid ? await fromUuid(merchantUuid) : null;
    const seller = sellerUuid ? await fromUuid(sellerUuid) : null;
    if (!user || !merchant || !seller || merchant.uuid === seller.uuid) return fail('Missing');
    if (!isMerchant(merchant)) return fail('NotMerchant');
    if (!seller.testUserPermission(user, 'OWNER')) return fail('NotOwner');

    const config = getMerchantConfig(merchant);
    const wanted = new Map();
    for (const line of Array.isArray(lines) ? lines : []) {
        const quantity = Math.max(1, Math.floor(Number(line?.quantity) || 1));
        if (line?.itemId) wanted.set(line.itemId, (wanted.get(line.itemId) ?? 0) + quantity);
    }

    const sold = [];
    const refused = [];
    for (const [itemId, requested] of wanted) {
        const item = seller.items.get(itemId);
        if (!item) continue;
        const unit = sellProblem(item) ? 0 : await unitPrice(merchant, item, config);
        if (unit <= 0) {
            refused.push(item.name);
            continue;
        }
        const available = itemQuantity(item);
        const quantity = Math.min(available, requested);
        sold.push({ item, quantity, available, unit, subtotal: unit * quantity });
    }
    if (!sold.length) return fail('NothingToSell', { refused });

    const total = sold.reduce((sum, line) => sum + line.subtotal, 0);
    const purse = goldToBase(merchant.system?.gold);
    if (!config.unlimitedPurse && purse < total) return fail('MerchantBroke', { total });

    // Items for the merchant: stack consumables/loot with what she already has.
    const toCreate = [];
    const pending = new Map();
    const merchantUpdates = new Map();
    for (const line of sold) {
        const data = line.item.toObject();
        delete data._id;
        if (data.system && 'equipped' in data.system) data.system.equipped = false;
        const stackable = STACKABLE_TYPES.includes(line.item.type) && typeof line.item.system?.quantity === 'number';
        if (stackable) {
            const key = `${line.item.type}|${normalName(line.item.name)}`;
            const existing = merchant.items.find(
                i => i.type === line.item.type && normalName(i.name) === normalName(line.item.name)
            );
            if (existing) {
                const current = merchantUpdates.get(existing.id) ?? itemQuantity(existing);
                merchantUpdates.set(existing.id, current + line.quantity);
            } else if (pending.has(key)) {
                pending.get(key).system.quantity += line.quantity;
            } else {
                data.system.quantity = line.quantity;
                pending.set(key, data);
                toCreate.push(data);
            }
        } else {
            for (let i = 0; i < line.quantity; i++) {
                const copy = foundry.utils.deepClone(data);
                if (copy.system && 'quantity' in copy.system) copy.system.quantity = 1;
                toCreate.push(copy);
            }
        }
    }

    // Items leaving the seller.
    const toDelete = sold.filter(l => l.quantity >= l.available).map(l => l.item.id);
    const sellerUpdates = sold
        .filter(l => l.quantity < l.available)
        .map(l => ({ _id: l.item.id, 'system.quantity': l.available - l.quantity }));

    // Gold: the payout is added to the seller in the enabled denominations.
    const payout = splitBase(total);
    const sellerGold = Object.fromEntries(
        Object.entries(payout).map(([key, count]) => [
            `system.gold.${key}`,
            (Number(seller.system?.gold?.[key]) || 0) + count
        ])
    );

    try {
        if (toCreate.length) await merchant.createEmbeddedDocuments('Item', toCreate);
        if (merchantUpdates.size) {
            await merchant.updateEmbeddedDocuments(
                'Item',
                [...merchantUpdates].map(([_id, quantity]) => ({ _id, 'system.quantity': quantity }))
            );
        }
        if (sellerUpdates.length) await seller.updateEmbeddedDocuments('Item', sellerUpdates);
        if (toDelete.length) await seller.deleteEmbeddedDocuments('Item', toDelete);
        await seller.update(sellerGold);
        if (!config.unlimitedPurse) {
            const remaining = splitBase(purse - total);
            await merchant.update(
                Object.fromEntries(DENOMINATIONS.map(([key]) => [`system.gold.${key}`, remaining[key] ?? 0]))
            );
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Sale failed`, err);
        return fail('Failed', { error: err.message });
    }

    await postSaleMessage({ user, merchant, seller, sold, refused, total });
    return {
        ok: true,
        total,
        sold: sold.map(l => ({ name: l.item.name, quantity: l.quantity })),
        refused
    };
}

async function postSaleMessage({ user, merchant, seller, sold, refused, total }) {
    const esc = foundry.utils.escapeHTML;
    const rows = sold
        .map(l => `<li>${F('Chat.Line', { quantity: l.quantity, name: esc(l.item.name), subtotal: formatMoney(l.subtotal) })}</li>`)
        .join('');
    const refusedLine = refused.length
        ? `<p class="hint">${F('Chat.Refused', { names: refused.map(esc).join(', ') })}</p>`
        : '';
    const content = `
        <div class="dh-lootbox-sale">
            <h3>${F('Chat.Title', { merchant: esc(merchant.name) })}</h3>
            <ul>${rows}</ul>
            <p><strong>${F('Chat.Total', { seller: esc(seller.name), total: formatMoney(total) })}</strong></p>
            ${refusedLine}
        </div>`;
    const whisper = new Set(ChatMessage.getWhisperRecipients('GM').map(u => u.id));
    whisper.add(user.id);
    await ChatMessage.create({ content, whisper: [...whisper], speaker: { alias: merchant.name } });
}

/** Sends the sale to the active GM and waits for the answer. */
async function requestSale(merchant, seller, lines) {
    const payload = { userId: game.user.id, merchantUuid: merchant.uuid, sellerUuid: seller.uuid, lines };
    const gm = game.users.activeGM;
    if (!gm) return fail('NoGM');
    if (gm.isSelf) return handleSellQuery(payload);
    try {
        return await gm.query(QUERY_NAME, payload, { timeout: QUERY_TIMEOUT });
    } catch (err) {
        console.error(`${MODULE_ID} | Sale query failed`, err);
        return fail('Timeout');
    }
}

function errorMessage(result) {
    const key = `DHLOOTBOX.Trade.Errors.${result?.reason ?? 'Failed'}`;
    const data = {
        total: result?.total !== undefined ? formatMoney(result.total) : '',
        names: (result?.refused ?? []).join(', '),
        error: result?.error ?? ''
    };
    return game.i18n.has(key) ? game.i18n.format(key, data) : L('Errors.Failed');
}

/* -------------------------------------------------------------------------- */
/*  Trade counter (player window)                                             */
/* -------------------------------------------------------------------------- */

const appId = (prefix, actor) => `${prefix}-${actor.uuid.replace(/\./g, '-')}`;

export class TradeCounter extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        classes: ['dh-lootbox-trade'],
        window: { icon: 'fa-solid fa-scale-balanced', resizable: true },
        position: { width: 480, height: 'auto' },
        actions: {
            removeLine: TradeCounter.#onRemoveLine,
            clear: TradeCounter.#onClear,
            confirm: TradeCounter.#onConfirm
        }
    };

    static PARTS = {
        body: { template: `modules/${MODULE_ID}/templates/trade-counter.hbs` }
    };

    static #instances = new Map();

    /** Opens (or brings forward) the counter of a merchant, optionally adding an item to it. */
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
        this.seller = TradeCounter.#defaultSeller();
        /** @type {Map<string, number>} item id → quantity offered */
        this.lines = new Map();
        this.busy = false;
        this.hookIds = [];
    }

    static #defaultSeller() {
        const character = game.user.character;
        return character?.isOwner ? character : null;
    }

    get title() {
        return F('CounterTitle', { name: this.merchant.name });
    }

    /** Puts an item from the player's sheet on the counter. Nothing leaves the sheet yet. */
    async stage(item, { render = true } = {}) {
        const actor = item?.actor;
        if (!item || !actor) return ui.notifications.warn(L('Warn.DropFromSheet'));
        if (actor.uuid === this.merchant.uuid) return;
        if (!actor.isOwner) return ui.notifications.warn(L('Warn.NotYourItem'));
        if (!SELLABLE_TYPES.includes(item.type)) return ui.notifications.warn(F('Warn.NotSellable', { name: item.name }));
        if (this.seller && this.seller.uuid !== actor.uuid) {
            if (this.lines.size) return ui.notifications.warn(F('Warn.OneSeller', { name: this.seller.name }));
        }
        this.seller = actor;
        const current = this.lines.get(item.id) ?? 0;
        this.lines.set(item.id, Math.min(itemQuantity(item), current + 1) || 1);
        if (render) this.render();
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const config = getMerchantConfig(this.merchant);
        const lines = [];
        let total = 0;
        for (const [itemId, wanted] of [...this.lines]) {
            const item = this.seller?.items.get(itemId);
            if (!item) {
                this.lines.delete(itemId);
                continue;
            }
            const max = Math.max(1, itemQuantity(item));
            const quantity = Math.min(Math.max(1, wanted), max);
            this.lines.set(itemId, quantity);
            const problem = sellProblem(item);
            const unit = problem ? 0 : await unitPrice(this.merchant, item, config);
            const refused = unit <= 0;
            const subtotal = refused ? 0 : unit * quantity;
            total += subtotal;
            lines.push({
                id: itemId,
                name: item.name,
                img: item.img,
                quantity,
                max,
                quantifiable: max > 1,
                quantityLabel: F('QuantityLabel', { name: item.name }),
                refused,
                priceLabel: refused
                    ? L(problem ? `Problem.${problem}` : 'WontBuy')
                    : quantity > 1
                    ? F('PriceEach', { total: formatMoney(subtotal), each: formatMoney(unit) })
                    : formatMoney(unit)
            });
        }
        const broke = !config.unlimitedPurse && total > goldToBase(this.merchant.system?.gold);
        const hasGM = !!game.users.activeGM;
        return Object.assign(context, {
            merchant: { name: this.merchant.name, img: this.merchant.img },
            seller: this.seller ? { name: this.seller.name, img: this.seller.img } : null,
            lines,
            hasLines: lines.length > 0,
            totalLabel: formatMoney(total),
            broke,
            hasGM,
            busy: this.busy,
            canConfirm: total > 0 && !broke && hasGM && !this.busy
        });
    }

    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        this.element.addEventListener('dragover', event => event.preventDefault());
        this.element.addEventListener('drop', event => this.#onDrop(event));

        const relevant = actor => actor && [this.seller?.uuid, this.merchant.uuid].includes(actor.uuid);
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
                this.lines.set(input.dataset.itemId, Math.max(1, Math.floor(Number(input.value) || 1)));
                this.render();
            });
        }
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

    static #onRemoveLine(_event, target) {
        this.lines.delete(target.dataset.itemId);
        this.render();
    }

    static #onClear() {
        this.lines.clear();
        this.render();
    }

    static async #onConfirm() {
        if (!this.seller || this.busy || !this.lines.size) return;
        const lines = [...this.lines].map(([itemId, quantity]) => ({ itemId, quantity }));
        this.busy = true;
        await this.render();
        const result = await requestSale(this.merchant, this.seller, lines);
        this.busy = false;
        if (result?.ok) {
            ui.notifications.info(
                F('Sold', { merchant: this.merchant.name, seller: this.seller.name, total: formatMoney(result.total) })
            );
            this.lines.clear();
            await this.close();
        } else {
            ui.notifications.warn(errorMessage(result));
            if (this.rendered) this.render();
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Price table (GM window)                                                   */
/* -------------------------------------------------------------------------- */

export class PriceTable extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        tag: 'form',
        classes: ['dh-lootbox-prices'],
        window: { icon: 'fa-solid fa-tags', resizable: true },
        position: { width: 580, height: 'auto' },
        form: { handler: PriceTable.#onSubmit, closeOnSubmit: true },
        actions: {
            removeOverride: PriceTable.#onRemoveOverride,
            fillFromStock: PriceTable.#onFillFromStock
        }
    };

    static PARTS = {
        body: { template: `modules/${MODULE_ID}/templates/price-table.hbs` }
    };

    static open(merchant) {
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

    constructor({ merchant, ...options } = {}) {
        super({ id: appId('dh-lootbox-prices', merchant), ...options });
        this.merchant = merchant;
        this.draft = getMerchantConfig(merchant);
    }

    get title() {
        return F('Prices.Title', { name: this.merchant.name });
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const step = smallestUnit() / HANDFUL;
        const toInput = base => Math.round((base / HANDFUL) * 10) / 10;
        const coinsOn = enabledDenominations().some(([key]) => key === 'coins');
        return Object.assign(context, {
            unlimitedPurse: this.draft.unlimitedPurse,
            step,
            unitHint: coinsOn ? L('Prices.UnitHintCoins') : L('Prices.UnitHint'),
            tiers: [1, 2, 3, 4].map(tier => F('Prices.Tier', { tier })),
            categories: SELLABLE_TYPES.map(type => {
                const label = L(`Category.${type}`);
                return {
                    type,
                    label,
                    cells: this.draft.defaults[type].map((base, index) => ({
                        index,
                        value: toInput(base),
                        aria: `${label} — ${F('Prices.Tier', { tier: index + 1 })}`
                    }))
                };
            }),
            overrides: this.draft.overrides.map((o, index) => ({
                index,
                name: o.name,
                img: o.img,
                value: toInput(o.price),
                label: o.price > 0 ? formatMoney(roundToUnit(o.price)) : L('WontBuy')
            }))
        });
    }

    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        this.element.addEventListener('dragover', event => event.preventDefault());
        this.element.addEventListener('drop', event => this.#onDrop(event));
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const toBase = input => Math.max(0, Math.round((Number(input.value) || 0) * HANDFUL));
        this.element.querySelector('[name="unlimitedPurse"]')?.addEventListener('change', event => {
            this.draft.unlimitedPurse = event.currentTarget.checked;
        });
        for (const input of this.element.querySelectorAll('input[data-default-type]')) {
            input.addEventListener('input', () => {
                this.draft.defaults[input.dataset.defaultType][Number(input.dataset.tierIndex)] = toBase(input);
            });
        }
        for (const input of this.element.querySelectorAll('input[data-override-index]')) {
            input.addEventListener('input', () => {
                const override = this.draft.overrides[Number(input.dataset.overrideIndex)];
                if (override) override.price = toBase(input);
            });
            input.addEventListener('change', () => this.render());
        }
    }

    /** Adds an item to the per-item list, starting from the price it would get now. */
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
        const price = await unitPrice(this.merchant, item, { ...this.draft, overrides: [] });
        this.draft.overrides.push({ key, name: item.name, img: item.img, price });
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
        let added = 0;
        for (const item of this.merchant.items) {
            if (await this.#addOverride(item, { quiet: true })) added++;
        }
        ui.notifications.info(F('Prices.Filled', { count: added }));
        this.render();
    }

    static async #onSubmit() {
        await this.merchant.update({ [`flags.${MODULE_ID}.${CONFIG_FLAG}`]: foundry.utils.deepClone(this.draft) });
        ui.notifications.info(F('Prices.Saved', { name: this.merchant.name }));
    }
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                              */
/* -------------------------------------------------------------------------- */

export function registerTrade() {
    CONFIG.queries[QUERY_NAME] = handleSellQuery;
}

export const tradeApi = {
    setMerchant,
    isMerchant,
    getMerchantConfig,
    unitPrice,
    formatMoney,
    openTradeCounter: (merchant, options) => TradeCounter.open(merchant, options),
    openPriceTable: merchant => PriceTable.open(merchant)
};
