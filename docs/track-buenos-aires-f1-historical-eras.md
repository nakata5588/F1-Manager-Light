# Buenos Aires F1 historical GP geometries (1953–1998)

One canonical physical venue: **`tr_0018`** (Autódromo Oscar y Juan Gálvez).
Distinct historic *configurations* are not new tracks or separate result archives.

| Period | F1 GP configuration | Actual F1 lap used here | Race direction | Geometry package |
|---|---|---:|---|---|
| 1953 | Circuit No. 2 | 3.912 km | clockwise | `tr_0018_no2` |
| **1954** | **same Circuit No. 2** | **3.912 km** | **counter-clockwise** | `tr_0018_no2` with reverse flag |
| 1955–1960 | Circuit No. 2 | 3.912 km | clockwise | `tr_0018_no2` |
| 1972–1973 | Circuit No. 9 (shortened hairpin) | **3.345 km** | clockwise | `tr_0018_no9` |
| 1974–1981 | Circuit No. 15 | 5.968 km | clockwise | **existing verified F1Track**, unchanged drawing |
| 1995–1998 | Circuit No. 6 with Senna S | 4.259 km | clockwise | `tr_0018_no6_senna` |

F1DB's No. 9 illustration metadata says 3.353 km, other archival F1 race
references vary between 3.345 and 3.346 km. The 1972 and 1973 **race**
length here is 3.345 km, independently cross-checked with STATS F1
(95×3.345 = 317.775 km in 1972, 96×3.345 = 321.120 km in 1973).
This is a historical data-choice, not a demand to reshape the vector.

## Source and limitations

- [F1DB Buenos Aires catalog](https://github.com/f1db/f1db/blob/main/src/data/circuits/buenos-aires.yml): identifies exactly SVG 1 = No.2 (1953–58 and 1960), SVG 2 = No.9 (1972–73), SVG 3 = No.15 (1974–81), SVG 4 = No.6 (1995–98).
- Vector traces adapted and sampled from the [F1DB black SVG assets](https://github.com/f1db/f1db/tree/main/src/assets/circuits/black), Jules Roy, **CC BY 4.0**, [license](https://creativecommons.org/licenses/by/4.0/). No.2 is drawn as nine open connected strokes in the source SVG; assembled into one closed centreline. Two small source-stroke retrace crossings were smoothed locally before sampling, with a deterministic no-self-crossing regression test.
- [Argentine GP history](https://en.wikipedia.org/wiki/Argentine_Grand_Prix): No.2 reused with reverse running direction **only in 1954**.
- [STATS F1 Buenos Aires archive](https://www.statsf1.com/pt/circuit-buenos-aires.aspx): period-specific GP lap lengths.
- [RacingCircuits Buenos Aires map archive](https://www.racingcircuits.info/south-america/argentina/buenos-aires.html): original circuits, alterations, period overview.

**Provisional** SVG geometry is a visually derived cartographic path, not an
FIA-surveyed or GPS racing line. 1953–60, 1972–73, 1995–98 historic pit entries
and precise sector splits are unknown: we do **not** fabricate pit lane points,
pit entry/exit or claimed verified split points. Their cartographic curves
must **not** become physical corner-speed/incident models. The previously
verified No.15 circuit package is kept untouched geometrically and continues
to drive its existing 1980 track-speed intelligence.

No period-valid geometry is returned for gaps such as 1961–1971, 1982–1994,
1999 onward. Race simulation may continue without a visual racing line for
those times; display-only fallback cannot silently show the wrong GP circuit.

The single `BUENOS_AIRES_LENGTH_PERIODS` constant is referenced by the
historical packages **and** the existing No.15 package. The track resolver's
1954 reversal is generic and uses the same points in the reverse order while
preserving point zero. Both `TrackModel` and `RaceStrategy` already share
`historicalTrackLapLengthKm`, so neither needs a second hand-coded timeline.

## Regression

- `node --test tests/trackLayout.test.js tests/race2TrackModel.test.js tests/raceStrategy.test.js`
- `npm run check`
- existing CI full 2000 GP and smoke test

Manual Race View checks, only when requested: 1953, 1954, 1972, 1980 and
1995 Buenos Aires; verify start, anti-clockwise 1954, 1980 No.15 unchanged.
