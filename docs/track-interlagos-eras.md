# Interlagos — one circuit identity, two F1 geometry families

## Verified chronology

The original long Interlagos opened in 1940 and hosted F1 world championship races 1973–77 and 1979–80. In 1978 and 1981–89 the Brazilian GP raced at Jacarepaguá, **not** Interlagos. Interlagos itself was rebuilt/shortened for the F1 return in 1990.

| Years | GP layout family | Measured lap | Notes |
|---|---|---:|---|
| 1973–1977 | `tr_0028_long` | 7,960 m | Historic high-speed long F1 circuit |
| 1979–1980 | `tr_0028_long` | 7,873 m | 1979 refurbishment; same main long route but altered features / pit entry |
| 1990–1995 | `tr_0028_short` | 4,325 m | 1990 new shorter course (Senna S) |
| 1996–1998 | `tr_0028_short` | 4,292 m | Minor revisions to short layout |
| 1999 onward | `tr_0028_short` | 4,309 m | Current GP layout, modified pit entry over time |

**Both** use `track_id="tr_0028"`, and both are traversed **counter-clockwise**. The 1979 and 1996/1999 length differences are factual data, NOT separate clones of the geometry. 1996/1999 local changes await better surveyed lines; we explicitly mark both map families provisional. 2014 revised pit-lane chicane remains an overlay detail, not a third complete GP path.

## Sources and licensing

- São Paulo municipal circuit [official facts](https://autodromodeinterlagos.prefeitura.sp.gov.br/circuito), [history](https://autodromodeinterlagos.prefeitura.sp.gov.br/historia), [timeline](https://autodromodeinterlagos.prefeitura.sp.gov.br/linhadotempo): 7,960m original, 7,873m after 1979, 4,325m after 1990; F1 year chronology.
- [Lap Ledger chronology](https://www.lapledger.org/circuits/interlagos) and [Interlagos historical variation list](https://en.wikipedia.org/wiki/Interlagos_Circuit): 1996–98 4,292m; 1999+ 4,309m.
- [F1DB Interlagos long SVG](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/interlagos-1.svg) and [short SVG](https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/interlagos-2.svg), author **Jules Roy**, **CC BY 4.0**. New centerlines are distance-sampled adaptations of those source vector paths. [License](https://creativecommons.org/licenses/by/4.0/).
- Original and 1990 annotated schematic diagrams from [ge.globo's historical comparison](https://ge.globo.com/motor/formula-1/noticia/2022/11/09/de-interlagos-a-jacarepagua-veja-momentos-historicos-da-f1-no-brasil.ghtml).

## Contracts

- `tr_0028` remains the **one stable Track ID** in Calendar, Season Packs, Race Simulation and Results.
- Only the 1990 complete redesign triggers a second geometrical centerline. `src/data/tracks/tr_0028_interlagos.f1track.js` holds **both** shapes and **one** table of historical lap lengths. `TrackModel` reads periods from this package when no year-specific metadata is supplied; explicit race-state metre snapshots continue to win to preserve saves.
- Layouts are exact-era-scoped and never silently substituted for pre-F1 calendar years.
- Both visual SVG sources are **derived_provisional**, not georeferenced GPS. Sector boundaries are provisional thirds. Historic pit line differences aren't yet surveyed: **no fictional pit lane** is drawn.
- As in the Albert Park implementation, cartographic outlines must not drive race physics; avoid duplicating timing, speed or overtaking rules in the UI.

## Test commands

`node --test tests/trackLayout.test.js tests/race2TrackModel.test.js`
`npm run test:race-parity`
`npm run build`

Check Interlagos 1980 vs 2000 in Race View, plus historical lap length, anti-clockwise movement and consistent game results.
