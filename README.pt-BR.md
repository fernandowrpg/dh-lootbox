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

## Lojista: comprar itens dos jogadores

Qualquer baú (ou loja) pode virar uma **lojista** que compra itens dos jogadores.
O mestre define quanto ela paga. Quando o jogador confirma, os itens vão para ela
e o ouro vai para o personagem, sem ninguém mexer nas fichas à mão.

**Mestre: configurar a lojista**

1. Abra a ficha do baú e clique em **"Tornar lojista"** no cabeçalho. A
   permissão padrão do baú passa a ser **Observador**: os jogadores veem o
   estoque, mas não podem mais tirar itens nem alterar nada. A permissão
   anterior volta quando você clica em **"Deixar de ser lojista"**.
2. A **Tabela de preços** abre em seguida (ela também fica no cabeçalho):
   - **Preço padrão por tipo e tier**: quanto ela paga por unidade de arma,
     armadura, consumível e item de loot. Armas e armaduras usam o tier do item;
     consumíveis e loot usam a raridade nas tabelas "Loot" e "Consumables" do
     sistema (Comum = Tier 1 … Lendário = Tier 4).
   - **Preços por item**: arraste itens do compêndio, da barra lateral ou de uma
     ficha para a lista para dar um preço só a eles, que vale sobre o padrão.
     **"Adicionar o estoque dela"** preenche a lista com o que ela já tem.
   - Os valores são em **punhados** (10 punhados = 1 saco, 10 sacos = 1 baú).
     Com moedas ativadas nas configurações de Homebrew do sistema, use decimais:
     0,5 = 5 moedas. **0 significa que ela não compra.**
   - **Bolsa sem fundo**: desmarcada, ela paga com o ouro da própria ficha e
     recusa vendas acima do que tem. Marcada, o ouro dela não muda.

**Jogador: vender**

1. Abra a ficha da lojista e arraste um item da ficha do seu personagem para
   ela (ou para a janela **Balcão de troca**, que abre pelo cabeçalho).
2. O balcão lista cada item com quanto ela paga. Ajuste as quantidades, tire o
   que não quer vender e confira o total. Itens que ela não compra, ou que estão
   equipados, aparecem marcados e não entram na conta.
3. Clique em **Confirmar venda**. Até esse momento os itens continuam na sua
   ficha.

**Como a venda é feita**

- O jogador não tem permissão no ator da lojista, então o balcão manda a venda
  para o **mestre ativo** como uma query do Foundry (`CONFIG.queries`, v13+). O
  cliente do mestre confere tudo de novo (dono do personagem, quantidades,
  preços, ouro dela) e então move tudo: os itens para a lojista (consumíveis e
  loot se empilham com o que ela já tem) e o ouro para o personagem, dividido em
  baús, sacos e punhados.
- Uma venda roda por vez, então dois jogadores não gastam a mesma bolsa.
- Um resumo é sussurrado para o mestre e para o jogador. **Precisa haver um
  mestre conectado**; sem ele, o balcão avisa e nada é movido.
- Por macro: `api.setMerchant(actor, true)`, `api.openPriceTable(actor)` e
  `api.openTradeCounter(actor)` em `game.modules.get('dh-lootbox').api`.

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
  cabeçalho da janela). A **lojista** é a exceção: ela fica como Observador
  (veja acima) e só o mestre pode entregar itens do estoque dela.
- As quantidades de ouro por Tier são uma sugestão aproximada (o site não
  define uma tabela fixa de "ouro por baú"); ajuste os valores na ficha do
  baú a qualquer momento antes de disponibilizá-lo aos jogadores.
- Se quiser gerar vários baús de uma vez (por exemplo, para espalhar em
  diferentes salas de uma masmorra), use o campo "Quantidade de baús a criar"
  no diálogo.
- O módulo já vem com traduções em inglês e Português (Brasil); ele segue o
  idioma configurado no seu cliente do Foundry.
