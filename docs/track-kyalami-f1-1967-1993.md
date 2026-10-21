# Kyalami F1 history (1967–1993): one venue, two routes

Canonical ID: **`tr_0067`** in `core_tracks`, calendar, Race View, Strategy and Results.
`data/tracks.json` also has a legacy `tr_0009` *noncanonical dataset entry*:
do not add a second runtime circuit or migrate result IDs in this PR.

| Championship year | Physical course | Race lap length | Direction |
|---|---|---:|---|
| 1967 | Original circuit (`tr_0067_original`) | **4.094 km** | Clockwise |
| 1968–1985 | Same physical route; amended recorded distance | **4.104 km** | Clockwise |
| 1986–1991 | **No championship GP** | No F1 race fact | No F1 geometry exposed |
| 1992–1993 | Completely reconstructed early 1990s course (`tr_0067_rebuilt`) | **4.261 km** | Counterclockwise |
| 1994 onward | No F1 GP; modern track has further rebuilds | No F1 race fact | No period-F1 geometry exposed |

Kyalami is race **3** of the 1980 F1 season (1 March 1980).
The South African GP was 78 × 4.104 km = **320.112 km**; 1992/93
were 72 × 4.261 km = 306.792 km.
One sampled F1DB SVG per physical route, **not** one copy per year.

## Provenance and accuracy

- [F1DB circuit chronology](https://github.com/f1db/f1db/blob/main/src/data/circuits/kyalami.yml)
  associates `kyalami-1` with the older F1 era and `kyalami-2`
  with 1992–93; SVGs by **Jules Roy**, **CC BY 4.0**.
- [F1DB original SVG](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/kyalami-1.svg) and
  [reconstructed SVG](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/kyalami-2.svg),
  downsampled to 240 equal-arclength approximate centreline points.
- [StatsF1 1968 race](https://www.statsf1.com/en/1968/afrique-du-sud.aspx),
  [StatsF1 1980 race](https://www.statsf1.com/en/1980/afrique-du-sud.aspx) and
  [StatsF1 1985 race](https://www.statsf1.com/en/1985/afrique-du-sud.aspx)
  record **4.104 km**, despite F1DB's single old-layout length
  of **4.094 km**; [1967 results](https://en.wikipedia.org/wiki/1967_South_African_Grand_Prix)
  record **4.094 km**. This difference changes **length facts only**,
  not the sourced path.
- [StatsF1 1993 race](https://www.statsf1.com/fr/1993/afrique-du-sud.aspx)
  confirms **4.261 km**. Historical [South African History Online](https://sahistory.org.za/place/kyalami-grand-prix-circuit)
  confirms clockwise circulation and original circuit context.
- [Historic direction change](https://www.motorsportradar.com/tracks/kyalami-grand-prix-circuit/)
  identifies switch to anticlockwise after 1980s restructuring.
  The historical shapes are illustrative, **not** surveyed centreline,
  GPS, physical speed or elevation measurements.

## Compatibility and explicit limits

The pre-existing `tr_0067_provisional` (2016 reference artwork)
is retained for that exact **non-F1 reference year only**, rather than
being displayed falsely in **1980**. Neither the 1967–85 nor 1992–93
F1 geometry appears outside its exact period, including 1986–91 or 1994–2015.
Do not project the 1992 map onto the current 2016+ rebuilt circuit.
A non-F1 2016 provisional map is not evidence of F1 participation.

The `KYALAMI_LENGTH_PERIODS` list is consumed by the *existing*
`historicalTrackLapLengthKm` resolver, so Strategy and TrackModel
agree without a new physics path or annual data copies.
Historical racing line status is `derived_provisional`; neutral physical
speed profile remains; no verified pit entry/exit, sector boundaries,
braking zones or physical corners are invented. Existing saved metre snapshots
continue to take precedence.

## Regression

`node --test tests/trackLayout.test.js tests/race2TrackModel.test.js tests/raceStrategy.test.js`

Also run `npm run check` and `npm run build` via CI.
1980 Renault race-weekend visual inspection remains a separate acceptance
test; geometry tests alone do not prove car flow, camera, pace or saves.
