# Mónaco — seis linhas históricas F1 com uma única identidade

O GP do Mónaco de **18 de maio de 1980** (ronda 6 de 14) usou
**76 × 3,312 km = 251,712 km**, vencedor Carlos Reutemann.
Identidade canónica: `tr_0056` (`core_tracks`, Calendar, Results).
Não modificar IDs, o arquivo, a física nem os saves existentes.

## Traçados realmente identificados

| F1 anos | Desenho | Metros/volta | Proveniência / garantia |
| --- | --- | ---: | --- |
| 1950 | `monaco-1.svg` | 3180 | F1DB 1950 (RacingCircuits diverge nos 1929–54) |
| 1955–1972 | `monaco-2.svg` | 3145 | Fórmula 1 e RacingCircuits |
| 1973–1975 | `monaco-3.svg` | 3278 | Reconfiguração túnel, Piscine e Rascasse |
| **1976–1985** | **`monaco-4.svg`** | **3312** | **Mónaco 1980**, Sainte-Dévote / Anthony Noghès revistos |
| 1986–1996 | `monaco-5.svg` | 3328 | Nova chicane do porto; **não** estender cegamente até 2002 |
| 2003–2014 | `monaco-6.svg` | 3340 | Desenho indicativo pós-2003, não GPS |
| 2015–atualidade | mesma **referência visual aproximada** `monaco-6.svg` | 3337 | Correção de Tabac não suficientemente representada por SVG separado |

São **seis geometrias-base**, não sete réplicas físicas.
Os **comprimentos por época** são factos independentes da cartografia.
Não há GP F1 em Mónaco nos anos 1951–1954 (não se extrapola 1950).
Em 2020 não houve GP mas a configuração física persistiu.

## Lacunas e diferenças de fontes

**1997–2002:** há alteração documentada da sequência da Piscine
e comprimentos aproximados **3367–3370 m**. O F1DB atribui
`monaco-5.svg` a 1986–2002 sem fornecer vetor exclusivo para
o redesign de 1997. Por fidelidade, o jogo **não apresenta uma
geometria historicamente exata para 1997–2002**, nem reutiliza
indevidamente 1986. Esta lacuna fica para trabalho próprio.

**1950:** F1DB indica 3180 m para a corrida; RacingCircuits agrupa
1929–54 em 3145 m. Esta PR assume a metragem histórica **da época
F1DB 1950**, documenta a discrepância, não inventa um terceiro layout.

**2003–2014:** RacingCircuits regista 3340 m; F1DB resume modernos
em 3337 m. Em 2015 houve pequeno ajuste de Tabac, pelo que
a linha `monaco-6.svg` serve apenas como **cartografia aproximada**
para o último grupo. Não qualificar como contorno GPS exato,
nem utilizar para travagem ou setores.

**Partida / setores / boxes:** as mudanças históricas na localização
da partida não são reconstruídas apenas a partir de um SVG ilustrativo.
`start_finish_progress=0` é ponto de referência visual, não a
posição histórica FIA. Setores em terços, sem pit lane inferida.
As geometrias são `derived_provisional` e não governam velocidades.

O fallback SVG anterior sem ano `tr_0056_provisional` fica no manifest
para compatibilidade com ficheiros existentes, mas a sua geometria é
explicitamente bloqueada fora de uma época confirmada.

## Fontes

- [F1DB Mónaco, seis épocas](https://github.com/f1db/f1db/blob/main/src/data/circuits/monaco.yml)
  e [SVG monaco-1.svg](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/monaco-1.svg)
  até [monaco-6.svg](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/monaco-6.svg),
  Jules Roy, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [RacingCircuits.info](https://www.racingcircuits.info/europe/monaco/monte-carlo.html):
  distingue 1997–2002, 2003–2014 e 2015–atualidade.
- [Motor Sport Magazine, evolução 1929–presente](https://www.motorsportmagazine.com/articles/single-seaters/f1/monaco-grand-prix-circuit-layout-how-its-changed-since-1929/):
  alterações físicas, mudanças de 1973/1976 e do porto.
- [Formula 1, classificação Mónaco 1980](https://www.formula1.com/en/results/1980/races/85/monaco/race-result):
  vencedor e 76 voltas.
- [L'Équipe, Mónaco 1980](https://www.lequipe.fr/Formule-1/Formule1ClassementGP467_5.html):
  76 × 3,312 = 251,712 km.

## Testes

- `tests/trackLayout.test.js`: períodos, orientação, fidelidade 1980,
  bloqueio 1997–2002, amostragem 240 pontos, zero cruzamentos.
- `tests/race2TrackModel.test.js`: km por época, velocidade neutra e
  projeção em metros, proteção em anos sem traçado verificado.
- `tests/raceStrategy.test.js`: uma cronologia canónica, corrida
  1980 com 76 voltas, distância 251,712 km.
- CI: `npm run check`, build, regressão carreira Renault 1980,
  Season Pack 2000 e corrida integral Austrália 2000.
- Race View visual x1/x8/x16 **ainda requer inspeção** (não inferir
  validação visual a partir do CI).
