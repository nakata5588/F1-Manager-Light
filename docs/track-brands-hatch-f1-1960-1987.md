# Brands Hatch — histórico dos traçados, GP de 1980

**Identidade canónica:** `tr_0081` (Brands Hatch, Kent). A mesma para
Calendar, Race Strategy, Race TrackModel, Results e saves. Não criar um
`track_id` por ano, nem substituir `core_tracks` ou `f1_db.xlsx`.

## Duas configurações documentadas para o Grand Prix loop

| Geometria | Período do asfalto | Metros/volta | F1 no GP loop |
| --- | --- | ---: | --- |
| `tr_0081_original` | 1960–1975 | **4.265** | GP 1964, 1966, 1968, 1970, 1972, 1974 |
| `tr_0081_1976_1987` | 1976–1987 | **4.207** | GP 1976, 1978, **1980**, 1982, 1984, 1986 |

No GP de **13 julho 1980**, ronda **8** do campeonato:
**76 voltas × 4,207 km = 319,732 km**, vencedor Alan Jones.
O layout correto é **`tr_0081_1976_1987`**.
A partir de 1988 surgiram alterações físicas (Westfield, Graham Hill
e chicane de Dingle Dell). Não reutilizar a linha de 1980 nesse período.
O GP de F1 deixou de se realizar em Brands Hatch depois de 1986,
mas o asfalto de 1976–87 continuou fisicamente existente em 1987.

As mudanças da década de 1950 ocorreram no circuito curto, antes da
extensão GP de agosto de 1960. O circuito de 1950–53, inicialmente
**anti-horário**, NÃO deve receber o traçado Grand Prix com o mesmo
sentido horário do GP de 1980. Para esses períodos antigos, faltam
vetores próprios e a geometria fica não verificada. Nas fontes
[F1DB](https://github.com/f1db/f1db/blob/main/src/data/circuits/brands-hatch.yml)
os desenhos têm títulos abreviados (1964–74 e 1976–86), enquanto
[RacingCircuits](https://www.racingcircuits.info/europe/united-kingdom/brands-hatch.html)
documenta a existência física 1960–75 e 1976–87.

## Geometria, física e confiança

Cada desenho F1DB de Jules Roy (licença CC BY 4.0) foi convertido em
linha cartográfica fechada com **240 pontos equidistantes no arco**.
SVG 1 tem curvas Bézier e arcos; SVG 2 também contém arcos.
Foram verificados sentido horário, continuidade e ausência de
autocruzamentos; **não são levantamentos GPS**.
O ponto inicial é referência do vetor e não localização histórica FIA
da partida. `sector_boundaries` são terços ilustrativos. `pit_entry`
e `pit_exit` continuam `null`, sem inventar distâncias ou trajectórias.

Marcar as duas geometrias `derived_provisional` impede o modelo de
velocidades de as interpretar como curvas físicas reais.
`geometry_exact_era_only` impede que a pista GP de 1980 apareça
em anos 1988+ ou antes da extensão de 1960. Preserva-se o registo
anterior `tr_0081_provisional` para compatibilidade, mas sem
usar o desenho sem data como prova histórica de 1980.

## Referências

- [F1DB Brands Hatch](https://github.com/f1db/f1db/blob/main/src/data/circuits/brands-hatch.yml)
  e SVGs [`brands-hatch-1.svg`](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/brands-hatch-1.svg)
  e [`brands-hatch-2.svg`](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/brands-hatch-2.svg).
  Cartografia de Jules Roy, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [RacingCircuits.info](https://www.racingcircuits.info/europe/united-kingdom/brands-hatch.html):
  1960–75 = 4.265 km; 1976–87 = 4.207 km, posteriores alterações.
- [Bemsee, história da pista](https://www.bemseearchives.co.uk/history/our-history/):
  extensão GP de 1960, reconstrução das boxes em 1976, obras em 1988,
  mudança histórica de sentido em 1954.
- [StatsF1, GP da Grã-Bretanha de 1980](https://www.statsf1.com/en/1980/grande-bretagne.aspx):
  76 × 4.207 = 319.732 km, vencedor Alan Jones.
- [RacingSportsCars — GP Grã-Bretanha 1980](https://www.racingsportscars.com/f1/results/Brands_Hatch-1980-07-13f.html):
  local confirmado como Brands Hatch.

### Divergência nos resultados do fornecedor Formula1.com

A [página F1 de 1980](https://www.formula1.com/en/results/1980/races/87/great-britain/race-result)
identifica na ficha «Silverstone Circuit» apesar de ser o GP realizado
em Brands Hatch (StatsF1, Motorsport Magazine e outras fontes).
Não alterar `track_id` com base nesse campo inconsistente.

## Testes

`node --test tests/trackLayout.test.js tests/race2TrackModel.test.js tests/raceStrategy.test.js`.

QA: cada variante, 240 pontos, sentido e cruzamentos; 1980 seleciona
4.207 km e 76 voltas. O perfil de velocidade continua **neutral**.
A corrida arquivada/snapshot existente é prioritária sobre valores
genéricos do catálogo. `npm run check`, build, carreira Renault
1980, Season Pack 2000 e GP integral Austrália 2000, pelo CI.

A validação visual x1/x8/x16 em Race View continua por realizar.
