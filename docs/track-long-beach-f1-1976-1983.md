# Long Beach — three Formula One historical street routes, one tr_0088

**1980:** US Grand Prix West, fourth round. Same canonical `track_id` in
Calendar, Results, Race Strategy and TrackModel. No annual circuit clones.

| F1 years | Distinct driving route | Lap distance | Direction |
| --- | --- | --- | --- |
| 1976–1981 | `tr_0088_1976_1981` original | 3.251 km | Clockwise |
| 1982 | `tr_0088_1982` redesign | 3.428 km | Clockwise |
| 1983 | `tr_0088_1983` further redesign | 3.275 km | Clockwise |

Three distinct F1DB SVG paths, all sampled at **240 constant arclength
intervals** in visual coordinates. 1978 moved the start location but did
not require a fourth geometric route. Layout sources are not GPS surveys.

## Critical 1980 race-distance subtlety

[StatsF1](https://www.statsf1.com/en/1980/etats-unis-ouest.aspx)
records **80 laps × 3.251 km + 1.625 km start/finish offset
= 261.705 km**, whereas 80 ordinary laps alone equal **260.080 km**.
The current Strategy/TrackModel supports normal lap counts and lap
length, *not* this historical stagger. **Do not mislabel 260.080 km as
the official total**, and do not fabricate a start location or engine
distance correction from the illustrated SVG. Future start-offset support
requires its own canonical Race Core change and tested persistence.
The 1980 lap length remains exactly 3.251 km.

## Sources

- [F1DB circuit metadata](https://github.com/f1db/f1db/blob/main/src/data/circuits/long-beach.yml):
  three route eras; 3.251, 3.428, 3.275 km; clockwise.
- Jules Roy, **CC BY 4.0** historic vectors:
  [1976–81](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/long-beach-1.svg),
  [1982](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/long-beach-2.svg),
  [1983](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/long-beach-3.svg).
  [License](https://creativecommons.org/licenses/by/4.0/).
- [RacingCircuits.info Long Beach history](https://www.racingcircuits.info/north-america/usa/long-beach.html):
  independent calendar/layout changes and period lap lengths.
- [FIA Formula E retrospective](https://www.fiaformulae.com/en/news/races/insight-the-history-of-racing-at-long-beach):
  original course through 1981, rebuilt 1982 and further 1983 change.
- [StatsF1 1980 race](https://www.statsf1.com/en/1980/etats-unis-ouest.aspx):
  80 laps; exceptional start/finish offset.

## Compatibility and fidelity boundaries

`tr_0088_provisional`, reference artwork from **2000**, stays in
the asset manifest for 2000 alone. **Never display that shape in 1980**.
Neither F1 era nor 2000 art should spill into other epochs; 1984–99
and 2001+ have no F1-derived art. Post-1983 Long Beach races were CART/
IndyCar, not Formula One. All F1 `geometry_exact_era_only` families
share a single `LONG_BEACH_LENGTH_PERIODS` history consumed by the
existing `historicalTrackLapLengthKm` resolver and Strategy/TrackModel.

Quality `derived_provisional` prevents SVG lines from driving physical
corner-speed, overtakes, incidents or safety rules. Neutral speed model;
pit entry, pit exit, FIA sector boundaries and start/finish location
are **unverified** and not invented. Existing save metre snapshots
continue taking precedence.

## Checks

`node --test tests/trackLayout.test.js tests/race2TrackModel.test.js tests/raceStrategy.test.js`

`npm run check` and `npm run build` via CI. Visual verification of
1976, 1980, 1982 and 1983 remains separate and is not CI validated.
