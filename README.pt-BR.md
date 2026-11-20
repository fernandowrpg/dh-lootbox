# Baús de Loot — Daggerheart

*[Read in English](README.md)*

Módulo para **Foundry VTT v13** (testado com v13.351) + sistema **Daggerheart v1.9.14**
que gera baús de loot seguindo as regras oficiais de geração por Tier/raridade
(https://daggerheart.org/core-mechanics/loot e /consumables), usando os
compêndios reais do sistema — os itens sorteados **são** os documentos do
compêndio (armas, armaduras, consumíveis e itens de "Loot"), então já chegam
prontos e arrastáveis para a ficha do personagem.

## Como funciona por baixo dos panos

- Sorteia nas RollTables **"Loot"** e **"Consumables"** que já vêm dentro do
  compêndio `rolltables` do próprio sistema Daggerheart, usando a fórmula de
  dados correspondente à raridade do Tier escolhido (Comum `2d12`, Incomum
  `3d12`, Raro `4d12`, Lendário `5d12` — exatamente como descrito no site).
- Sorteia uma quantidade configurável de armas e de armaduras (um campo para
  cada), filtrando pelo campo
  `system.tier` dos compêndios `weapons`/`armors`.
- Opcionalmente sorteia ouro (punhados/sacos/baús) usando uma faixa aproximada
  por Tier, inspirada na tabela de "Custo médio" de equipamento por Tier do
  guia do mestre.
- O baú em si é um **Actor do tipo "party"** (o mesmo tipo usado para a ficha
  de grupo), porque esse tipo já vem, de fábrica, com: campo de ouro, restrição
  de itens a arma/armadura/consumível/item, e o mais importante — **o sistema
  já implementa arrastar-e-soltar de itens (e ouro) de um Actor "party" direto
  para um Actor "character"**, com todo o tratamento de quantidade/empilhamento.
  O módulo só usa uma ficha simplificada (só Inventário, sem as abas de
  "Membros do Grupo"/"Descanso" que não fazem sentido para um baú).
- A permissão padrão do baú é definida como **Dono (Owner)** para todos os
  jogadores, para que qualquer jogador possa abrir a ficha e puxar itens sem
  precisar que o mestre configure permissão individualmente.

## Instalação

**Opção A — pela URL do manifesto (recomendado):**

1. Na tela de Setup do Foundry, vá em **Add-on Modules** → **Install Module**.
2. Cole a URL do manifesto:
   `https://github.com/fernandowrpg/dh-lootbox/releases/latest/download/module.json`
3. Clique em **Install**.

**Opção B — manual:**

1. Baixe o `dh-lootbox.zip` da [última release](https://github.com/fernandowrpg/dh-lootbox/releases/latest)
   e extraia dentro da pasta `Data/modules/` da sua instalação do Foundry, de
   modo que o arquivo `module.json` fique em `Data/modules/dh-lootbox/module.json`.
2. Abra seu mundo (que deve estar usando o sistema **Daggerheart**).
3. Vá em **Configurar Módulos** e ative **"Loot Chests — Daggerheart"**.
4. Recarregue o mundo.

## Loja de Consumíveis

O macro **"🧪 Gerar Loja de Consumíveis"** (ou `game.modules.get('dh-lootbox').api.openShopDialog()`)
lista **todos** os consumíveis do compêndio `daggerheart.consumables`. Filtre por nome,
marque os que a lojista vende e a quantidade de cada um; o módulo cria um Actor
(mesma ficha dos baús) com o estoque, pronto para os jogadores arrastarem os itens
para a ficha do personagem.

## Lojista: comprar e vender com os jogadores

Qualquer baú pode ser **posto à venda**: um baú de loot sorteado, uma loja de
consumíveis ou um que você encheu à mão. Ele vira uma lojista: os jogadores
compram do estoque dela e vendem para ela itens das próprias fichas, pelos
preços que o mestre define. Na confirmação, os itens vão nos dois sentidos e só
a diferença em ouro muda de mão.

**Mestre: pôr um baú à venda**

- Num baú que já existe, clique em **"Pôr à venda (lojista)"** no cabeçalho da
  ficha. Para criar baús (ou uma loja) já à venda, marque **"Pôr à venda"** no
  diálogo de geração. Isso serve para os baús de tesouro que você joga na cena.
- Um baú à venda fica com permissão padrão **Observador**: os jogadores veem o
  estoque, mas não pegam itens nem alteram nada. **"Tirar da venda"** devolve a
  permissão anterior.

**Mestre: preços**

- **Tabela padrão** (botão **"Tabela padrão"** em qualquer tabela de preços, ou
  `api.openDefaultPriceTable()`): vale para todo baú à venda sem tabela própria.
  Assim os baús gerados já chegam prontos para negociar. Enquanto você não a
  salvar, ela vem preenchida pela tabela "Custos Médios" do livro básico
  (cobra: armas/armaduras/loot 3 punhados · 1,5 bolsa · 7,5 bolsas · 1,5 baú
  nos Tiers 1–4; consumíveis 2 punhados · 5 punhados · 2 bolsas · 5 bolsas;
  paga cerca de metade). O livro não precifica consumíveis e loot, então esses
  valores são uma sugestão.
- **Tabela de preços** de um baú (botão no cabeçalho dele): salvar cria uma
  tabela só para aquele baú; **"Usar a tabela padrão"** volta para a padrão.
- Cada tabela tem duas grades, **quanto ela paga** (compra dos jogadores) e
  **quanto ela cobra** (vende aos jogadores), por tipo de item e tier. Armas e
  armaduras usam o tier do item; consumíveis e loot usam a raridade nas tabelas
  "Loot" e "Consumables" do sistema (Comum = Tier 1 … Lendário = Tier 4).
- **Preços por item**: arraste itens do compêndio, da barra lateral ou de uma
  ficha para a lista e dê a eles preços próprios de "paga" e "cobra". Campo
  vazio segue a grade; **"Adicionar o estoque dela"** lista tudo o que ela tem.
- Os valores são em **punhados** (10 punhados = 1 saco, 10 sacos = 1 baú). Com
  moedas ativadas nas configurações de Homebrew do sistema, use decimais: 0,5 =
  5 moedas. **0 significa que ela não negocia o item daquele jeito** (não compra
  ou não vende).
- **Bolsa da troca**: de onde sai e para onde vai o ouro de cada troca. Por
  padrão é o próprio baú da troca. Escolha **o baú da lojista** e todo baú que
  usa aquela tabela passa a vender em nome dela. Isso inclui os baús de tesouro
  à venda na cena, pela tabela padrão. Os jogadores pagam para o baú dela e ela
  paga a eles com o ouro desse baú. Os itens continuam saindo do baú da troca
  (ou entrando nele).
- **Bolsa sem fundo**: desmarcada, a bolsa paga com o próprio ouro (e recusa o
  que não pode pagar) e guarda o que recebe. Marcada, o ouro da bolsa nunca
  muda.

**Jogador: o balcão de troca**

1. Abra a ficha da lojista e clique em **"Balcão de troca"**. Arrastar um item
   da sua ficha para a dela também abre o balcão. Se você tem mais de um
   personagem, escolha qual negocia no topo.
2. **Você vende**: arraste itens da sua ficha para o balcão.
   **Você compra**: clique no **+** ao lado de um item do estoque dela.
3. Ajuste as quantidades e confira as somas: quanto ela paga, quanto ela cobra
   e o saldo ("você recebe" ou "você paga"). Itens que ela não negocia, ou que
   estão equipados, aparecem marcados e não entram na conta.
4. Clique em **Confirmar troca**. Até esse momento nada sai do lugar.

**Como a troca é feita**

- O jogador não tem permissão no ator da lojista, então o balcão manda a troca
  para o **mestre ativo** como uma query do Foundry (`CONFIG.queries`, v13+). O
  cliente do mestre confere tudo de novo (dono do personagem, quantidades,
  estoque, preços, as duas bolsas) e então move tudo: os itens nos dois
  sentidos (consumíveis e loot se empilham com o que cada lado já tem) e a
  diferença em ouro, dando troco quando precisa quebrar uma moeda maior.
- Uma troca roda por vez, então dois jogadores não gastam a mesma bolsa nem
  compram o mesmo item duas vezes.
- Um resumo é sussurrado para o mestre e para o jogador. **Precisa haver um
  mestre conectado**; sem ele, o balcão avisa e nada é movido.
- Por macro: `api.setMerchant(actor, true)`, `api.openPriceTable(actor)`,
  `api.openDefaultPriceTable()` e `api.openTradeCounter(actor)` em
  `game.modules.get('dh-lootbox').api`.

## Como usar

1. Um macro chamado **"🎁 Gerar Baú de Loot"** (ou o equivalente em inglês, se
   o idioma do seu Foundry estiver em English) é criado automaticamente na
   hotbar do mestre na primeira vez que o mundo carrega com o módulo ativo.
   Clique nele (ou execute `game.modules.get('dh-lootbox').api.openChestDialog()`
   num macro de script/console).
2. Escolha o **Tier** do baú (1 a 4) e a **distribuição de dados**:
   - *Uniforme (dado único)* — ex.: `1d12` no Tier 1 — dá chance igual pra
     cada item daquela faixa de raridade e nunca ultrapassa esse teto.
   - *Curva de sino (múltiplos dados)* — ex.: `2d12` no Tier 1 — favorece
     resultados do meio da faixa, mas às vezes alcança um pouco a raridade
     seguinte. É a mesma fórmula padrão que as RollTables oficiais do sistema
     Daggerheart já trazem, e é a opção selecionada por padrão.

   As duas opções vêm direto das regras do site (por exemplo, o Tier 1/Comum
   permite explicitamente `1d12 ou 2d12`). Os campos de quantidade de itens,
   consumíveis, armas e armaduras e a caixa de "incluir ouro" já vêm
   preenchidos com uma sugestão padrão para aquele Tier, mas podem ser
   ajustados livremente antes de confirmar.
3. Marque **"Posicionar automaticamente no centro da cena atual"** se quiser
   que o baú já apareça como um token na cena aberta — ou deixe desmarcado e,
   depois, simplesmente arraste o Actor gerado (ele aparece numa pasta "Baús
   de Loot" na aba **Atores**) para o mapa, do jeito tradicional do Foundry.
4. Um resumo do conteúdo de cada baú é enviado como mensagem de chat
   sussurrada **apenas para o mestre**, como registro (os jogadores não veem
   esse spoiler).
5. Os jogadores abrem a ficha do token do baú (clique duplo) e **arrastam**
   qualquer item (ou o ouro) direto para a ficha do próprio personagem — a
   transferência (quantidade, remover do baú, somar na ficha) é feita
   automaticamente pelo próprio sistema Daggerheart.

## Observações e limitações

- Como o baú usa o tipo de Actor "party", ele aparecerá na lista de Atores
  junto com as fichas de personagem — o nome do baú (ex.: "Baú — Tier 2
  (Incomum)") ajuda a diferenciar.
- A permissão "Dono" para todos os jogadores significa que qualquer jogador
  conectado pode mexer no baú (inclusive apagar itens) — é o modelo mais
  simples para um contêiner comunitário de loot. Se quiser restringir, ajuste
  a permissão manualmente pela ficha do Actor (ícone de configuração no
  cabeçalho da janela). Um **baú à venda** é a exceção: ele fica como
  Observador (veja acima) e os jogadores pegam os itens comprando no balcão.
- As quantidades de ouro por Tier são uma sugestão aproximada (o site não
  define uma tabela fixa de "ouro por baú"); ajuste os valores na ficha do
  baú a qualquer momento antes de disponibilizá-lo aos jogadores.
- Se quiser gerar vários baús de uma vez (por exemplo, para espalhar em
  diferentes salas de uma masmorra), use o campo "Quantidade de baús a criar"
  no diálogo.
- O módulo já vem com traduções em inglês e Português (Brasil); ele segue o
  idioma configurado no seu cliente do Foundry.
