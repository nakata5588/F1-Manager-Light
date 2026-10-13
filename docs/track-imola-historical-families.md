# Imola historical circuit layout families — one F1 venue

Physical circuit identity: `tr_0047`, **Autodromo Enzo e Dino Ferrari**.
The GP had different names, but the physical venue stays the same track ID,
including the **1980 Italian GP**, the **San Marino GPs 1981–2006**, and
the modern Emilia-Romagna GP. Never create separate Tracks/Results identities
for those names.

## Historic geography and calendar

| Period | Main car-track changes | Physical lap length | Geometry ID / fidelity |
|---|---|---:|---|
| 1953–1972 | Original, no chicanes (1963 non-title F1 GP) | 5.018 km | `tr_0047_original`; **schematic only** |
| 1973 | Variante Bassa, before Variante Alta | 5.122 km | `tr_0047_1973`; **schematic only** |
| 1974–1978 | Variante Alta + Bassa | 5.060 km | `tr_0047_1974_1994`; illustrated path |
| 1979–1980 | Permanent circuit and GP-era works; pre-1981 Acque Minerali | 5.040 km* | same family |
| 1981–1994 | Acque Minerali chicane; other small renovations | 5.040 km | same family; F1DB SVG 1 |
| 1995–2006 | Tamburello and Villeneuve chicanes; other safety changes | 4.959 km | `tr_0047_1995_2006`; F1DB SVG 2 |
| 2007 | Construction and pit rebuild; no championship GP | N/A | deliberately no exact-era geometry |
| 2008 onward | Variante Bassa bypassed for car racing | 4.909 km | `tr_0047_modern`; F1DB SVG 3 |

\* Records differ about the exact 1979–80 5.040 vs 5.060 transition.
We adopt the historical layout archive Gdecarli (1979–80 5.040 km),
and F1DB (1980–94 5.040 km); any year-specific source with verified
race-length data remains authoritative in `trackLayoutByYear`.
Do not create separate geometry files solely to represent 20 metres.

Year 1972 is **transitional**: Variante Bassa was added late in the year
(August per RacingCircuits.info; September 1973 modifications). Without an
event date in the geometry resolver, the original configuration is the
conservative default for 1972. Later event-specific metadata can refine it.

The 1953/1973 cartographic paths were **schematically back-derived** from
F1DB's pre-1995 SVG, flattening the Alta and/or Bassa detours. They have no
direct high-fidelity historical centerline source. The earlier physical layout
differed locally in ways this preliminary visualization does not measure.
They intentionally declare `schematic_provisional`. **Do not label them
historically verified or use them for corner speeds, damage, overtakes, time.**

The 1974–94 family is one approximate visual line, with the 1981 Acque
Minerali local change not differentiated in this version. A verified
historical centerline could justify a localized variant in the future.

## Source provenance, assets and permissions

- [Autodromo Imola official chronology](https://www.autodromoimola.it/en/history/)
  describes 1953 opening, 1970s variants, 1979 non-title GP, 1980 Italian GP,
  1995 redesign and 2007 works.
- [RacingCircuits.info Imola](https://www.racingcircuits.info/europe/italy/imola.html)
  documents summer 1972 / 1974 modifications.
- [Gdecarli Imola historic layout catalog](https://www.gdecarli.it/php2/circuit.php?var1=505&var2=2)
  differentiates 1973, 1974, 1979 and 1981 car layouts/lengths.
- [F1DB Imola data](https://github.com/f1db/f1db/blob/main/src/data/circuits/imola.yml):
  imola-1.svg (1980–94), imola-2.svg (1995–2006),
  imola-3.svg (modern). The 3 vectors were drawn by
  **Jules Roy, CC BY 4.0**;
  adapted as 240 equal-distance samples. [License](https://creativecommons.org/licenses/by/4.0/).
- Pre-1953 other maps: [1953–72 image](https://commons.wikimedia.org/wiki/File:Imola53.png),
  comparison reference only, not a survey.
- For 1995–2006 the lap length **4.959 km** from F1DB is used rather than
  the divergent 4.933 km listed in some summaries.

## Architecture and non-goals

Only one identity: `tr_0047`. The 5 geometry families are consecutive
documented route changes, **not 72 duplicated annual tracks**.
`IMOLA_LENGTH_PERIODS` holds factual lengths, read by the shared
`historicalTrackLapLengthKm` resolver and consumed by the
**Race Strategy** and **Race Simulation TrackModel** engines.
Existing explicit active-race snapshots in meters and year-specific DB
overrides remain authoritative.

SVGs are illustrative. No pit lane path, accurate pit entry/exit, or
FIA-measured sector boundaries are invented. Use neutral physical corner
profile until *verified functional geometry* is available, just as for
other provisional visualization packages.

## Testing

`node --test tests/trackLayout.test.js tests/race2TrackModel.test.js tests/raceStrategy.test.js`
`npm run check`
`npm run build`

Manual preview, if requested later: 1963 original, 1973 Bassa, 1980 classic,
2000 post-1995 and 2020 modern. Also verify 2007 gives no fallback racing line
and that the Australian GP 2000 benchmark stays unchanged.
