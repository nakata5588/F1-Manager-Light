# Paul Ricard — três percursos da Fórmula 1, um `track_id`

O circuito tem **um único ID `tr_0035`** no `core_tracks`, Calendar,
Strategy, Race TrackModel e Results. A ronda 7 da temporada de 1980 foi
disputada em **29 de junho de 1980**, na configuração longa original.

| Geometria | Período do traçado usado em F1 | Comprimento adotado | Fonte do desenho |
|---|---|---:|---|
| `tr_0035_original` | circuito original de 1970 até 1985 (GP F1 1971–85) | **5,810 km** | `paul-ricard-1.svg` |
| `tr_0035_short` | 1986–1990 | **3,813 km** | `paul-ricard-2.svg` |
| `tr_0035_modern` | GP de F1 de 2018–2019 e 2021–2022 | **5,842 km** | `paul-ricard-3.svg` |

Todos os desenhos são representações **cartográficas** amostradas por
distância ao longo do traçado em 240 pontos, com sentido horário;
não são medições FIA/GPS. O GP de 2020 foi cancelado mas a estrada
continuou fisicamente no local. A base `core_tracks` refere 5,842 km
da era moderna e **não** pode substituir o percurso original de 1980.

## Divergência métrica de 1 metro na configuração antiga

O [F1DB](https://github.com/f1db/f1db/blob/main/src/data/circuits/paul-ricard.yml)
publica **5,809 km** para o layout `paul-ricard-1`.
O arquivo [StatsF1 — França 1980](https://www.statsf1.com/en/1980/france.aspx)
dá **54 × 5,810 km = 313,740 km**.
O percurso cartográfico F1DB é utilizado como **forma**, mas a
cronologia da **simulação** utiliza a distância do arquivo de corrida
(5,810 km para a família antiga), evitando uma discrepância de 54 m
no GP de 1980. Não é uma quarta configuração da pista.

Nota: o `race_distance_km` exposto pela Strategy é arredondado
a uma casa decimal (313,7 km); esse resumo **não** substitui a
distância oficial calculada a 3 casas decimais (313,740 km).
As 54 voltas vêm dos factos do GP 1980, não da coluna genérica de
`core_tracks`.

## F1 e asfalto não são a mesma cronologia

O desenho original existia fisicamente desde a abertura de Paul Ricard
em 1970 até à alteração da rota de F1 em 1986; **nem todos os anos
foram GP de F1 neste circuito**. A geometria 1986–90 utilizou um
atalho que abandonava parte da reta Mistral e as curvas rápidas
correspondentes. Depois de 1990, a F1 regressou apenas em 2018.
A pista foi renovada em 2001, pelo que **não** se transporta o
traçado de 1980 para 1991–2017. Também não há aqui uma homologação
do percurso moderno para GPs F1 posteriores a 2022.

## Fontes

- [F1DB, Paul Ricard](https://github.com/f1db/f1db/blob/main/src/data/circuits/paul-ricard.yml):
  família longa 5,809 km, curta 3,813 km, moderna 5,842 km e sentido
  horário.
- Jules Roy, CC BY 4.0, SVGs:
  [original](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/paul-ricard-1.svg),
  [curta](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/paul-ricard-2.svg),
  [moderna](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/paul-ricard-3.svg),
  [licença](https://creativecommons.org/licenses/by/4.0/).
- [StatsF1, GP de França 1980](https://www.statsf1.com/en/1980/france.aspx):
  54 voltas, 5,810 km, 313,740 km.
- [F1, classificação 1980](https://www.formula1.com/en/results/1980/races/86/france/race-result):
  vencedor Alan Jones, 54 voltas.
- [RacingCircuits.info](https://www.racingcircuits.info/europe/france/paul-ricard.html):
  asfalto antigo, atalhos e história.
- [História oficial do Circuit Paul Ricard](https://www.circuitpaulricard.com/en/the-circuit/history):
  inauguração em 1970 e reforma profunda em 2001.

## O que esta alteração NÃO valida

`derived_provisional` não controla travagens, curvas, pneus,
velocidade máxima, incidentes, ultrapassagens ou pit lane.
`start_finish_progress: 0` é ponto-âncora do vetor, **não** posição
histórica de partida. `sector_boundaries` são terços ilustrativos.
Não inferimos boxes ou setores FIA da imagem.

O antigo fallback `tr_0035_provisional` permanece no manifest
por compatibilidade, mas `geometry_exact_era_only` impede que seja
utilizado fora de uma era atribuída. Não alterar o `f1_db.xlsx`
canónico, a engine, Results, Cars ou saves em curso.

Testes:
`node --test tests/trackLayout.test.js tests/race2TrackModel.test.js tests/raceStrategy.test.js`;
CI completo, Season Pack real de 2000, carreira Renault 1980 e GP
integral Austrália 2000. Verificação gráfica em x1/x8/x16 no
browser fica por fazer, de forma honesta e explícita.
