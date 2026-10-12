# Albert Park 1996–2020 — provisional canonical display geometry

## Scope

GP Australia 2000 uses track ID `tr_0019`, 58 laps and official lap length **5,303 m**. The original 16-corner circuit is **clockwise**. The later 2022 layout has changed corners and must not reuse this centerline.

## Primary vector & attribution

- **F1DB**: `src/assets/circuits/black/melbourne-1.svg`, original layout 1996–2019, drawing by **Jules Roy**. Licensed **Creative Commons Attribution 4.0 (CC BY 4.0)**. Adaptation: evenly spaced samples extracted from the SVG path, rotated to the start/finish on the original pit straight. Original: https://github.com/f1db/f1db/blob/main/src/assets/circuits/black/melbourne-1.svg ; license: https://creativecommons.org/licenses/by/4.0/
- **Historical orientation cross-check**: [Wikimedia Commons, Circuit Albert Park 1996.svg, AlexJ, CC0](https://commons.wikimedia.org/wiki/File:Circuit_Albert_Park_1996.svg), with numbered curves, start/finish, north arrow and travel indicators.
- **Further era/map confirmation**: [Oversteer48 original Albert Park 1996–2020 diagram](https://oversteer48.com/australia-f1-track-layout/), visual reference only, not included as an asset.
- **Contemporary 2000 driving description**: [Atlas F1, Australian GP circuit guide](https://www.atlasf1.com/2000/aus/preview/auslap.html). [F1 2000 pit-entry guide](https://www.neoseeker.com/f1-2000/faqs/31253-walkthrough.html) notes entry after turn 15.

## Explicit confidence boundaries

- This source is **stylized cartography, not georeferenced GPS**. The centerline's positions, start/finish progress and equal-distance sampling are for rendering only.
- The **pit lane and entry/exit fractions** are schematic approximations; its image is for orientation, not a physical survey.
- The authoritative 2000 model keeps its existing **16-turn provisional speed profile** in `tr_0019_1996_2020.speedProfile.js`; don't recalibrate corner severities from this vector map.
- `geometry_exact_era_only` prevents this old layout being silently reused for the reconfigured 2022+ circuit.
- The UI must continue to project the **canonical race state**, never calculate alternative gaps, results or speeds.

## Validation

- `node --test tests/trackLayout.test.js tests/race2TrackModel.test.js`
- `npm run test:race-parity` and `npm run build`
- Manual: New Game → 2000 → Australia → Race, verify visible clockwise motion, start before turn 1, pit entry after turn 15 and cars do not disappear. Watch the same-seed Autosim/Race View results.
