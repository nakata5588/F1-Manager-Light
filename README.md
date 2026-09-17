# F1 Manager Light

Historical Formula 1 management game built with React, Vite, Zustand and a JSON-backed simulation database.

## Development

Requirements: Node.js 22+.

```bash
npm ci
npm run dev
```

Vite starts the development server on port `5173` by default.

Before committing runtime changes, run:

```bash
npm run check
```

This validates the runtime data contracts and performs a production build.

## Data pipeline

The maintained database source is:

```text
data/f1_db.xlsx
```

Runtime JSON is generated into:

```text
public/data/
```

To rebuild it:

```bash
npm run build:data
npm run validate:data
```

`scripts/convert-excel.mjs` is the canonical Excel → JSON converter. The application reads its data from `public/data` through `GameStore`.

## Runtime architecture

The game deliberately distinguishes two kinds of state:

- **Database state** (`dbDrivers`, `dbTeams`, `dbCalendar`, contracts, rules, points systems, etc.): static source data loaded from `public/data`.
- **Career state** (date, player team, standings, race results, inbox, events, finances, etc.): mutable state that belongs to an individual save.

Saves use lightweight snapshots and omit the large `db*` collections. When a save is loaded, the app automatically reloads the static database before continuing the career.

### Race results

`gameState.results` is the canonical career race history. Each event stores its season, round, race identity and classification, including the driver's team at the time of the race. Championship standings are maintained by the race engine and `Results` / `Standings` consume that saved career state.

### Historical points systems

Race scoring must come from `public/data/points_systems.json`; do not hard-code one points table into gameplay code.

## Useful scripts

```bash
npm run dev            # development server
npm run build          # production build
npm run preview        # preview the production build
npm run build:data     # regenerate public/data from data/f1_db.xlsx
npm run validate:data  # validate required runtime JSON
npm run check          # validate data + production build
```

## CI

GitHub Actions validates runtime JSON and builds the application for pull requests. Changes to the source workbook or converter can regenerate `public/data` on the main branch.

## Stable IDs

Core entities use stable IDs such as `driver_id`, `team_id`, `track_id` and race/event identifiers. UI code should resolve display names separately and must not use display names as persistent identity.
