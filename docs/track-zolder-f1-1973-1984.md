# Zolder — histórico dos traçados da Fórmula 1 (1973–1984)

A identidade única de Zolder continua a ser **`tr_0026`**. É a pista do
**GP da Bélgica de 1980, ronda 5**. O calendário canónico já associa o
GP a `tr_0026`, pelo que não há substituição da base nem de IDs.

| Configuração física | GP F1 nesse desenho | Traçado | Comprimento | Sentido |
|---|---|---|---:|---|
| 1972–1974 | 1973 | `tr_0026_1972_1974` | 4,220 km | Horário |
| 1975–1985 | 1975–1982 e 1984 | `tr_0026_1975_1985` | 4,262 km | Horário |

Os intervalos são **períodos do asfalto**, não uma alegação de GP todos os
anos: **1974** foi disputado em Nivelles, **1983** em Spa-Francorchamps.
O F1DB identifica os SVG como `zolder-1` (1973) e `zolder-2`
(1975–82/1984); RacingCircuits.info confirma a continuidade física
entre 1972–74 e entre 1975–85.

## GP 1980: distância real

O boletim **oficial de F1 para o GP Bélgica de 2014, p. 25**
regista o GP de 4 de maio de 1980: **72 voltas × 4,262 km =
306,864 km**, pole Alan Jones, vencedor Didier Pironi. Não usar
os **70** da coluna genérica `laps_default` de `core_tracks`
como se fossem a distância oficial da prova de 1980. A informação de
72 voltas deve vir do GP/evento de 1980 ou de fonte histórica canónica.
Esta PR **não altera** o calendário, regras ou volta predeterminada
da simulação.

## Alterações físicas

A variante do GP de 1973 acrescentou uma chicane para diminuir
velocidade antes de Sacrament Hill, relativamente à pista de 1963–71.
Em 1975 as antigas curvas finais foram apertadas para a chicane Jacky
Ickx. Em 1982 a zona de boxes foi ampliada, mas não há documentação
suficiente para tratar isso como um **terceiro traçado de corrida**:
o F1DB utiliza um só SVG de 1975–82/1984 para a geometria principal.
RacingCircuits.info mostra mapas separados para 1975–81 e 1982–85,
de comprimento igual; não confundir desenho de pit lane com
necessariamente uma nova volta física. Qualidade **derived_provisional**.

A nova chicane Gilles Villeneuve na zona de Terlamen foi introduzida
em **1986**, depois do último GP de F1. Não se deve importar a variante
moderna para 1980. Os dois SVG históricos usados são cartográficos,
não levantamentos GPS, setores FIA, travagens, linha de boxes ou
posições reais da grelha. A velocidade do Race Core permanece neutra;
a geometria é uma camada de apresentação.

## Fontes

- [F1DB metadata](https://github.com/f1db/f1db/blob/main/src/data/circuits/zolder.yml)
  (1973 = 4.220 km, 1975–82/1984 = 4.262 km, sentido horário).
- Jules Roy, mapas
  [1973](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/zolder-1.svg) e
  [1975–82/1984](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/zolder-2.svg).
  Licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [RacingCircuits.info — Zolder](https://www.racingcircuits.info/europe/belgium/zolder.html):
  cronologia física 1963–71, 1972–74, 1975–81, 1982–85,
  alterações de chicanes e alargamento da pit lane em 1982.
- [FIA, Belgian Grand Prix 2014, press kit, p. 25](https://www.fia.com/sites/default/files/championship/event_report/documents/Belgian%20Media%20kit%202014.pdf):
  tabela oficial 1973–1984, número de voltas e distâncias de 1980.
- [Motor Sport Magazine, análise histórica](https://www.motorsportmagazine.com/articles/single-seaters/f1/f1-at-zolder-unravelling-the-history-of-belgiums-other-iconic-circuit/):
  chicane pós-1985 e alterações do circuito.

## Regressões

Os SVG são convertidos em 240 pontos com intervalo constante de arco e
enrolamento horário. Foram verificados **sem autocruzamentos**.
O antigo `tr_0026_provisional` mantém-se por compatibilidade com o
manifest, mas é bloqueado fora de uma era exata e deixa de surgir
como fallback histórico em 1980.

- `tests/trackLayout.test.js`: família única, anos, 1980 exato,
  sem fallback anacrónico, forma sem cruzamentos, metros e orientação.
- `tests/race2TrackModel.test.js`: comprimento e projeção contínua
  em metros, neutralidade do perfil de velocidade e ausência de boxes
  fabricadas.
- `tests/raceStrategy.test.js`: comprimento partilhado, distância
  oficial de **1980 = 306,864 km com 72 voltas**.
- CI `npm run check`, regressão 2000, build e teste integral de corrida.

A Race View visual de Zolder continua a exigir inspeção no browser
para comprovar escala, sentido e transições em x1/x8/x16.
