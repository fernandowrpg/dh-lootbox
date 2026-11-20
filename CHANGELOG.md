# Histórico de versões

Cada seção `## X.Y.Z` vira as notas da release `vX.Y.Z` (veja `.github/workflows/release.yml`).
Ao subir a versão no `module.json`, adicione a seção dela aqui no mesmo commit.

## 1.8.0

- Novo: a **tabela de preços padrão** já vem preenchida com a tabela "Custos Médios" do livro básico (p. 165). Armas e armaduras custam 3 punhados · 1,5 bolsa · 7,5 bolsas · 1,5 baú nos Tiers 1–4. O loot segue a mesma escala, e os consumíveis custam 2 punhados · 5 punhados · 2 bolsas · 5 bolsas. A lojista paga cerca de metade disso.
- O livro não define preço para consumíveis e loot, então esses valores são uma sugestão.
- Novo: botão **"Preços do livro"** em toda tabela de preços. Ele preenche as duas grades com os valores do livro e mantém os preços por item e a bolsa. Salve para aplicar.
- Mundos que já salvaram uma tabela padrão continuam com ela. Use o botão para voltar aos valores do livro.

## 1.7.0

- Novo: **Bolsa da troca** na tabela de preços: o baú de onde sai e para onde vai o ouro das trocas. Escolha o **baú da lojista** na tabela padrão e todo baú à venda na cena (inclusive os baús de tesouro gerados com "Pôr à venda") passa a vender em nome dela: o ouro das compras entra no baú dela e as vendas dos jogadores são pagas com o ouro dela.
- Os itens continuam saindo do baú em que o jogador está comprando (e entrando nele quando ele vende).
- O resumo no chat e o aviso ao jogador mostram o baú da lojista como quem paga ou recebe.
- Se o baú da bolsa for apagado, o balcão avisa e a troca é recusada sem mover nada.
- Por padrão, cada baú continua usando o próprio ouro até você escolher a bolsa.


