# Silverstone GP — one circuit, six nonduplicated display centerlines

Stable identity: **`tr_0079`**, Silverstone Circuit. The British GP rotated
between Silverstone, Aintree and Brands Hatch in the early decades. The calendar
and Results must keep each **actual** venue's distinct track ID; it is not
appropriate to assign every historic British GP to Silverstone.

## Documented physical GP layout family

| F1 years / historical era | Physical path family | Lap-length fact |
|---|---|---:|
| 1949–1951 (1950–51 championship) | original postwar perimeter `tr_0079_classic` | 4.649 km |
| 1952–1974 | **same perimeter family** after relocated pit/start line | 4.711 km |
| 1975–1986 | `tr_0079_woodcote`: Woodcote chicane | 4.719 km |
| 1987–1990 | `tr_0079_bridge`: Bridge / Luffield revisions | 4.778 km |
| 1991–1993 | `tr_0079_1991_1993`: extensive Maggotts/Becketts technical remake | 5.226 km |
| 1994–1995 | `tr_0079_1994_2009`: Abbey/Club/Priory safety remake | 5.057 km |
| 1996 | **same F1DB vector**; Stowe reprofiled locally | 5.072 km |
| 1997–1999 | **same F1DB vector**; further local reprofile | 5.140 km |
| 2000–2009 | **same F1DB vector**; 2000 GP reference | **5.141 km** |
| 2010 | `tr_0079_arena`: new Arena infield | **5.901 km** |
| 2011–present | **same Arena driving route**, relocated pits / start | **5.891 km** |

All are **clockwise**. The 1948 runway-based non-championship British GP
preceded the perimeter layout and is explicitly **not** mapped onto the
1949–1974 circuit; if that race is ever simulated, it needs its own
provenanced physical geometry, not a made-up adaptation.

### Critical source deduplication

F1DB documents **eight** named Silverstone SVG layouts, but
`silverstone-5.svg`, `silverstone-6.svg`, and `silverstone-7.svg`
are **byte-for-byte identical**. The 1994, 1996 and 1997 changes did occur
on the real circuit, but are **not represented** in those supplied SVG files.
We therefore store only **six independent visual centerlines** and a
**single period table** for exact race-distance facts.
A more accurate, externally sourced 1994–2009 survey could eventually
resolve these local geometric differences; we will not invent additional
interpolated copies merely because the archive uses separate labels.

### Race facts and discrepancies

- In the **1952** championship the Silverstone GP ran at ~4.7105 km per
  lap (unlike 4.649 km in 1950–51). Rounded period fact = **4.711 km**.
  Historical source diagrams grouping 1950–1974 as 4.649 km are inaccurate
  for race lengths after the relocated pits.
- **1997–1999** are recorded as 5.140 km; **2000 onward through 2009** at
  5.141 km. The Honda archive confirms **2000 5.141 km** and
  60 laps / 308.356 km; some older rounded summaries report 5.140 km.
  We follow Honda for the 2000–2009 period.
- **2010** new Arena measured **5.901 km**; **2011 onward** 5.891 km
  following the new pits/start relocation. Both use the same SVG layout.

## Sources and license

- [Silverstone official circuit history](https://www.silverstone.gp/en/history-of-the-circuit):
  1948 airfield, 1949 perimeter, 1952 start line, 1975 Woodcote,
  1987 Luffield and 1991 overhaul.
- [Official Silverstone venue history](https://www.silverstone.co.uk/about/our-history).
- [F1DB Silverstone catalog](https://github.com/f1db/f1db/blob/main/src/data/circuits/silverstone.yml):
  eight named layout eras; **do not equate eight names to eight physical
  files**.
- [F1DB Silverstone SVGs](https://github.com/f1db/f1db/tree/main/src/assets/circuits/black),
  designs by **Jules Roy**, attribution **CC BY 4.0**;
  [license](https://creativecommons.org/licenses/by/4.0/).
  Only unique source SVGs 1,2,3,4,5,8 are used, each sampled into a
  240-point arc-length visual path.
- [Honda's historical British GP results](https://global.honda/en/F1/circuit/silverstone-circuit/records/)
  documents 2000's 5.141 km lap.
- [1952 British GP archive](https://en.wikipedia.org/wiki/1952_British_Grand_Prix)
  documents the 4.7105 km race lap.
- [Silverstone development history](https://en.wikipedia.org/wiki/Development_history_of_Silverstone_Circuit)
  documents 2010/2011 changes and late-1990s re-profiling.
- [2010 British GP](https://en.wikipedia.org/wiki/2010_British_Grand_Prix)
  uses the 5.901 km Arena configuration;
  [2011 British GP](https://en.wikipedia.org/wiki/2011_British_Grand_Prix)
  uses 5.891 km.

## Engine integrity

`SILVERSTONE_LENGTH_PERIODS` is attached to each **family**, and the
existing shared `historicalTrackLapLengthKm` resolver is the **single
source of truth** for Race Strategy and TrackModel if the year-specific DB
has no override. Explicit race snapshots in metres continue to win for save
compatibility. Do not put lap distance, gaps, incidents, tyres or race result
computations in the UI.

All SVGs are **cartographic** and `derived_provisional`, not an FIA GPS
survey or a physical speed profile. Verified sector split points, pit entry
and pit exit are not reliably drawn across all eras, so they remain null /
provisional rather than fabricated. Those SVG paths cannot drive physical
corner-speed, DNF or overtaking rules.

## Regression and preview

- `node --test tests/trackLayout.test.js tests/race2TrackModel.test.js tests/raceStrategy.test.js`
- `npm run check`, `npm run build`
- Real 2000 opening, full Australia GP and Race Weekend/Results checks.
- Visual comparison for Silverstone **1950, 1979, 1987, 1991, 2000, 2010,
  2024**. In 2000, check 5.141 km and normal race direction. In 1948,
  do **not** render the future perimeter line.

The visual test in browser requires separate manual playtesting; CI proves
code/regression correctness, not the realism of car sizes or camera flow.
