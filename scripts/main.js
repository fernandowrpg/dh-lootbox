/**
 * Baús de Loot — Daggerheart
 * ---------------------------------------------------------------------------
 * Gera baús de loot (Actors do tipo "party" reaproveitados como contêineres)
 * seguindo as regras de geração por tier/raridade descritas em
 * https://daggerheart.org/core-mechanics/loot e https://daggerheart.org/core-mechanics/consumables,
 * usando as RollTables e compêndios oficiais que já vêm com o sistema Daggerheart
 * (packs: daggerheart.rolltables, daggerheart.loot, daggerheart.consumables,
 * daggerheart.weapons, daggerheart.armors).
 *
 * Os itens sorteados são cópias reais dos documentos do compêndio, então já
 * chegam prontos para ser arrastados para a ficha de um personagem — o próprio
 * sistema Daggerheart já sabe transferir itens (e ouro) por drag-and-drop entre
 * um Actor "party" e um Actor "character", então isso é reaproveitado como o
 * mecanismo de "abrir o baú e pegar o item".
 */

const MODULE_ID = 'dh-lootbox';
const CHEST_ICON = 'systems/daggerheart/assets/icons/documents/items/open-treasure-chest.svg';

/** Configuração padrão sugerida para cada Tier, conforme as tabelas do site. */
const TIER_DEFAULTS = {
    1: {
        rarityName: 'Common',
        rarityLabel: 'Comum',
        fallbackFormula: '2d12',
        lootCount: 1,
        consumableCount: 1,
        defaultIncludeEquipment: false,
        goldFormula: { handfuls: '1d4' }
    },
    2: {
        rarityName: 'Uncommon',
        rarityLabel: 'Incomum',
        fallbackFormula: '3d12',
        lootCount: 2,
        consumableCount: 2,
        defaultIncludeEquipment: true,
        goldFormula: { bags: '1', handfuls: '1d4' }
    },
    3: {
        rarityName: 'Rare',
        rarityLabel: 'Raro',
        fallbackFormula: '4d12',
        lootCount: 2,
        consumableCount: 3,
        defaultIncludeEquipment: true,
        goldFormula: { bags: '1d6 + 4' }
    },
    4: {
        rarityName: 'Legendary',
        rarityLabel: 'Lendário',
        fallbackFormula: '5d12',
        lootCount: 3,
        consumableCount: 3,
        defaultIncludeEquipment: true,
        goldFormula: { chests: '1d2' }
    }
};

/* -------------------------------------------------------------------------- */
/*  Ficha customizada do baú (reaproveita a ficha "Party" do sistema)         */
/* -------------------------------------------------------------------------- */

function registerChestSheet() {
    const { Party } = game.system.api.applications.sheets.actors;
    const { Actors } = foundry.documents.collections;

    class LootChestSheet extends Party {
        static DEFAULT_OPTIONS = foundry.utils.mergeObject(
            Party.DEFAULT_OPTIONS,
            { classes: ['party', 'loot-chest-sheet'] },
            { inplace: false }
        );

        /* Só reaproveitamos cabeçalho + navegação de abas + inventário.
           As abas de membros do grupo / descanso / notas não fazem sentido para um baú. */
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
                const cfg = TIER_DEFAULTS[tier];
                context.tierLabel = cfg ? `Baú — Tier ${tier} (${cfg.rarityLabel})` : 'Baú de Loot';
            }
            return context;
        }
    }

    Actors.registerSheet(MODULE_ID, LootChestSheet, {
        types: ['party'],
        makeDefault: false,
        label: 'Baú de Loot (Daggerheart)'
    });

    return LootChestSheet;
}

/* -------------------------------------------------------------------------- */
/*  Utilitários de sorteio                                                    */
/* -------------------------------------------------------------------------- */

async function getRollTableByName(name) {
    const pack = game.packs.get('daggerheart.rolltables');
    if (!pack) throw new Error('Compêndio "daggerheart.rolltables" não encontrado. O sistema Daggerheart está ativo?');
    const index = await pack.getIndex();
    const entry = index.find(e => e.name === name);
    if (!entry) throw new Error(`RollTable "${name}" não encontrada no compêndio de rolltables do Daggerheart.`);
    return pack.getDocument(entry._id);
}

/** Resolve a fórmula de dados correspondente a uma raridade nomeada na RollTable,
 *  usando as fórmulas alternativas (altFormula) que o próprio sistema já define. */
function getFormulaForRarity(table, rarityName, fallbackFormula) {
    const flag = table.flags?.daggerheart;
    if (!flag) return fallbackFormula;
    if (flag.formulaName === rarityName) return table.formula;
    const alt = Object.values(flag.altFormula ?? {}).find(f => f.name === rarityName);
    return alt?.formula ?? fallbackFormula;
}

async function rollFormula(formula) {
    const roll = new Roll(String(formula));
    await roll.evaluate();
    return roll.total;
}

/** Sorteia `count` vezes numa RollTable com a fórmula indicada e retorna os
 *  documentos de Item reais (do compêndio) referenciados pelos resultados. */
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

/** Sorteia uma arma ou armadura aleatória (50/50) filtrando pelo Tier do baú. */
async function drawEquipment(tier) {
    const packNames = ['daggerheart.weapons', 'daggerheart.armors'];
    const chosenPackName = packNames[Math.floor(Math.random() * packNames.length)];
    const pack = game.packs.get(chosenPackName);
    if (!pack) return null;

    const index = await pack.getIndex({ fields: ['system.tier'] });
    const options = index.filter(e => e.system?.tier === tier);
    if (!options.length) return null;

    const chosen = options[Math.floor(Math.random() * options.length)];
    return fromUuid(chosen.uuid);
}

async function getOrCreateChestFolder() {
    let folder = game.folders.find(f => f.name === 'Baús de Loot' && f.type === 'Actor');
    if (!folder) {
        folder = await Folder.create({ name: 'Baús de Loot', type: 'Actor', color: '#b8860b' });
    }
    return folder;
}

/* -------------------------------------------------------------------------- */
/*  Geração do baú                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} opts
 * @param {number} opts.tier               Tier do baú (1 a 4)
 * @param {string} [opts.name]              Nome do Actor gerado
 * @param {number} [opts.lootCount]         Quantos itens da tabela "Loot" sortear
 * @param {number} [opts.consumableCount]   Quantos consumíveis sortear
 * @param {boolean} [opts.includeEquipment] Sorteia 1 arma/armadura do Tier
 * @param {boolean} [opts.includeGold]      Sorteia ouro conforme o Tier
 * @returns {Promise<Actor>}
 */
async function generateLootChest(opts) {
    const tier = Number(opts.tier) || 1;
    const cfg = TIER_DEFAULTS[tier];
    if (!cfg) throw new Error(`Tier inválido: ${tier}`);

    const lootCount = Number.isFinite(opts.lootCount) ? opts.lootCount : cfg.lootCount;
    const consumableCount = Number.isFinite(opts.consumableCount) ? opts.consumableCount : cfg.consumableCount;
    const includeEquipment = opts.includeEquipment ?? cfg.defaultIncludeEquipment;
    const includeGold = opts.includeGold ?? true;
    const name = opts.name?.trim() || `Baú — Tier ${tier} (${cfg.rarityLabel})`;

    const lootTable = await getRollTableByName('Loot');
    const consumablesTable = await getRollTableByName('Consumables');

    const lootFormula = getFormulaForRarity(lootTable, cfg.rarityName, cfg.fallbackFormula);
    const consumableFormula = getFormulaForRarity(consumablesTable, cfg.rarityName, cfg.fallbackFormula);

    const lootDocs = lootCount > 0 ? await drawFromTable(lootTable, lootFormula, lootCount) : [];
    const consumableDocs = consumableCount > 0 ? await drawFromTable(consumablesTable, consumableFormula, consumableCount) : [];

    const equipmentDocs = [];
    if (includeEquipment) {
        const eq = await drawEquipment(tier);
        if (eq) equipmentDocs.push(eq);
    }

    const allDocs = [...lootDocs, ...consumableDocs, ...equipmentDocs];
    const itemsData = allDocs.map(doc => {
        const data = doc.toObject();
        delete data._id; // evita colisão de id se o mesmo item sortear mais de uma vez
        return data;
    });

    const gold = { coins: 0, handfuls: 0, bags: 0, chests: 0 };
    if (includeGold) {
        for (const [key, formula] of Object.entries(cfg.goldFormula)) {
            gold[key] = await rollFormula(formula);
        }
    }

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
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        flags: {
            core: { sheetClass: `${MODULE_ID}.LootChestSheet` },
            [MODULE_ID]: { isChest: true, tier }
        }
    });

    await whisperChestSummaryToGM(actor, { tier, cfg, lootDocs, consumableDocs, equipmentDocs, gold, includeGold });
    return actor;
}

async function whisperChestSummaryToGM(actor, { tier, cfg, lootDocs, consumableDocs, equipmentDocs, gold, includeGold }) {
    const listItems = docs => docs.map(d => `<li>${d.name}</li>`).join('');
    const goldParts = [];
    if (includeGold) {
        if (gold.chests) goldParts.push(`${gold.chests} baú(s) de ouro`);
        if (gold.bags) goldParts.push(`${gold.bags} saco(s)`);
        if (gold.handfuls) goldParts.push(`${gold.handfuls} punhado(s)`);
        if (gold.coins) goldParts.push(`${gold.coins} moeda(s)`);
    }

    const content = `
        <div class="daggerheart-loot-chest-summary">
            <h3>🎁 ${actor.name}</h3>
            <p><strong>Tier ${tier} — ${cfg.rarityLabel}</strong></p>
            ${lootDocs.length ? `<p><strong>Itens:</strong></p><ul>${listItems(lootDocs)}</ul>` : ''}
            ${consumableDocs.length ? `<p><strong>Consumíveis:</strong></p><ul>${listItems(consumableDocs)}</ul>` : ''}
            ${equipmentDocs.length ? `<p><strong>Equipamento:</strong></p><ul>${listItems(equipmentDocs)}</ul>` : ''}
            ${goldParts.length ? `<p><strong>Ouro:</strong> ${goldParts.join(', ')}</p>` : ''}
        </div>
    `;

    await ChatMessage.create({
        content,
        whisper: ChatMessage.getWhisperRecipients('GM').map(u => u.id),
        speaker: { alias: 'Gerador de Baús' }
    });
}

/* -------------------------------------------------------------------------- */
/*  Posicionamento no mapa                                                    */
/* -------------------------------------------------------------------------- */

async function placeChestOnCurrentScene(actor, offsetIndex = 0) {
    if (!canvas.ready || !canvas.scene) {
        ui.notifications.warn(
            `Baú "${actor.name}" criado, mas nenhuma cena está aberta. Arraste-o da barra de Atores para o mapa quando quiser.`
        );
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
    ui.notifications.info(`Baú "${actor.name}" posicionado na cena atual.`);
}

/* -------------------------------------------------------------------------- */
/*  Diálogo de criação                                                        */
/* -------------------------------------------------------------------------- */

function buildDialogContent() {
    return `
    <div class="daggerheart-loot-chest-dialog">
        <div class="form-group">
            <label>Tier do baú</label>
            <select name="tier">
                <option value="1">Tier 1 — Comum</option>
                <option value="2">Tier 2 — Incomum</option>
                <option value="3">Tier 3 — Raro</option>
                <option value="4">Tier 4 — Lendário</option>
            </select>
        </div>
        <div class="form-group">
            <label>Nome do baú</label>
            <input type="text" name="name" placeholder="Baú — Tier 1 (Comum)">
        </div>
        <div class="form-group">
            <label>Quantidade de baús a criar</label>
            <input type="number" name="quantity" value="1" min="1" max="10" step="1">
        </div>
        <hr>
        <div class="form-group">
            <label>Itens sorteados na tabela "Loot"</label>
            <input type="number" name="lootCount" min="0" max="10" step="1">
        </div>
        <div class="form-group">
            <label>Consumíveis sorteados</label>
            <input type="number" name="consumableCount" min="0" max="10" step="1">
        </div>
        <div class="form-group form-group-checkbox">
            <label><input type="checkbox" name="includeEquipment"> Incluir 1 arma/armadura aleatória do Tier</label>
        </div>
        <div class="form-group form-group-checkbox">
            <label><input type="checkbox" name="includeGold" checked> Incluir ouro (conforme o Tier)</label>
        </div>
        <div class="form-group form-group-checkbox">
            <label><input type="checkbox" name="placeOnScene"> Posicionar automaticamente no centro da cena atual</label>
        </div>
        <p class="hint">
            Dica: os valores acima são preenchidos com a sugestão padrão para o Tier escolhido,
            mas podem ser ajustados livremente antes de gerar.
        </p>
    </div>`;
}

function wireDialogDefaults(rootElement) {
    const root = rootElement instanceof HTMLElement ? rootElement : rootElement?.element;
    if (!root) return;
    const container = root.querySelector('.daggerheart-loot-chest-dialog');
    if (!container) return;

    const tierSelect = container.querySelector('[name="tier"]');
    const nameInput = container.querySelector('[name="name"]');
    const lootInput = container.querySelector('[name="lootCount"]');
    const consInput = container.querySelector('[name="consumableCount"]');
    const equipInput = container.querySelector('[name="includeEquipment"]');
    if (!tierSelect) return;

    const applyDefaults = () => {
        const tier = Number(tierSelect.value);
        const cfg = TIER_DEFAULTS[tier];
        if (!cfg) return;
        lootInput.value = cfg.lootCount;
        consInput.value = cfg.consumableCount;
        equipInput.checked = cfg.defaultIncludeEquipment;
        if (!nameInput.dataset.userEdited) {
            nameInput.value = `Baú — Tier ${tier} (${cfg.rarityLabel})`;
        }
    };

    tierSelect.addEventListener('change', applyDefaults);
    nameInput.addEventListener('input', () => {
        nameInput.dataset.userEdited = 'true';
    });
    applyDefaults();
}

async function openChestDialog() {
    if (!game.user.isGM) {
        ui.notifications.warn('Somente o mestre pode gerar baús de loot.');
        return;
    }

    let formResult;
    try {
        formResult = await foundry.applications.api.DialogV2.wait({
            window: { title: 'Gerar Baú de Loot — Daggerheart', icon: 'fa-solid fa-treasure-chest' },
            content: buildDialogContent(),
            buttons: [
                {
                    action: 'generate',
                    label: 'Gerar Baú(s)',
                    icon: 'fa-solid fa-treasure-chest',
                    default: true,
                    callback: (_event, button) => {
                        const form = button.form;
                        return {
                            tier: Number(form.elements.tier.value),
                            name: form.elements.name.value,
                            quantity: Math.max(1, Number(form.elements.quantity.value) || 1),
                            lootCount: Number(form.elements.lootCount.value) || 0,
                            consumableCount: Number(form.elements.consumableCount.value) || 0,
                            includeEquipment: form.elements.includeEquipment.checked,
                            includeGold: form.elements.includeGold.checked,
                            placeOnScene: form.elements.placeOnScene.checked
                        };
                    }
                },
                { action: 'cancel', label: 'Cancelar', icon: 'fa-solid fa-xmark' }
            ],
            rejectClose: false,
            render: (_event, element) => {
                try {
                    wireDialogDefaults(element);
                } catch (err) {
                    console.warn(`${MODULE_ID} | Não foi possível preencher os padrões do diálogo`, err);
                }
            }
        });
    } catch (err) {
        console.error(`${MODULE_ID} | Erro ao abrir o diálogo`, err);
        return;
    }

    if (!formResult) return; // cancelado

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
            console.error(`${MODULE_ID} | Erro ao gerar baú`, err);
            ui.notifications.error(`Erro ao gerar baú: ${err.message}`);
        }
    }

    if (createdActors.length) {
        ui.notifications.info(
            `${createdActors.length} baú(s) gerado(s) com sucesso. Confira o resumo na aba de chat (visível só para o mestre).`
        );
    }
}

/* -------------------------------------------------------------------------- */
/*  Registro do módulo                                                        */
/* -------------------------------------------------------------------------- */

Hooks.once('init', () => {
    if (game.system.id !== 'daggerheart') return;
    registerChestSheet();
});

Hooks.once('ready', async () => {
    if (game.system.id !== 'daggerheart' || !game.user.isGM) return;

    const moduleData = game.modules.get(MODULE_ID);
    if (!moduleData) {
        console.error(
            `${MODULE_ID} | Não encontrei o módulo em game.modules.get('${MODULE_ID}'). ` +
                `Verifique se a pasta em Data/modules tem exatamente esse nome e se o campo "id" do module.json é "${MODULE_ID}".`
        );
        return;
    }
    moduleData.api = {
        openChestDialog,
        generateLootChest,
        placeChestOnCurrentScene,
        TIER_DEFAULTS
    };

    // Cria (uma única vez) um macro de conveniência na hotbar do mestre.
    const macroName = '🎁 Gerar Baú de Loot';
    let macro = game.macros.find(m => m.name === macroName);
    if (!macro) {
        macro = await Macro.create({
            name: macroName,
            type: 'script',
            img: CHEST_ICON,
            command: `game.modules.get('${MODULE_ID}').api.openChestDialog();`,
            scope: 'global'
        });
    }

    const hotbar = game.user.hotbar ?? {};
    const alreadyPinned = Object.values(hotbar).includes(macro.id);
    if (!alreadyPinned) {
        for (let slot = 1; slot <= 50; slot++) {
            if (!hotbar[slot]) {
                await game.user.assignHotbarMacro(macro, slot);
                break;
            }
        }
    }
});
