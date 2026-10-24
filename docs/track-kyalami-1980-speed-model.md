# Kyalami: piloto experimental do perfil de velocidades

A linha SVG original de Kyalami 1980 tem qualidade `derived_provisional`;
por isso o `TrackModel` gerava `neutral` e `severity:0`, deixando
os carros sem travagens específicas nas curvas de Kyalami.

O novo perfil preserva o mesmo `tr_0067` e só se aplica ao layout
**`tr_0067_original`, 1967–1985**: nove curvas nomeadas (Kink,
Crowthorne, Barbeque, Jukskei, Sunset, Clubhouse, Esses 1/2 e Leeukop).
A variante reconstruída 1992–93 permanece neutra.

**Importante:** ordem/número/identidade das curvas e sentido de pista
constam das fontes; as frações ao longo da volta, amplitudes e larguras
das zonas de travagem são *estimativas de modelação*, não dados GPS,
telemetria ou velocidades históricas verificadas. **Não são calculadas
a partir do SVG cartográfico**. Falta ainda aferir alinhamento entre
o ponto inicial SVG e a linha de partida real.

A lógica `distance_sensitive` já existe na `RaceDynamics` canónica:
este patch fornece dados, não duplica a física. Os testes garantem
travagem diferenciada, determinismo e isolamento do layout reconstruído.

Fontes:
- https://sahistory.org.za/place/kyalami-grand-prix-circuit
- https://www.gdecarli.it/php2/circuit.php?var1=713&var2=2
- https://github.com/f1db/f1db/blob/main/src/data/circuits/kyalami.yml
- https://www.formula1.com/en/results/1980/awards/pole-positions
  (Kyalami pole 1980 **1:10.000**, referência externa, não benchmark superado).

**Estado experimental:** carece de benchmark real multi-seed na
corrida de Kyalami, com tempos, médias e top speed, DNFs, pneus,
gaps e ultrapassagens. CI verde não significa calibração física aprovada.
