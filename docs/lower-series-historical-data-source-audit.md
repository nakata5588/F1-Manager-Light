# Lower Series historical data — source audit

Status: research/audit only. This document does **not** authorise importing DB-Lab data into the canonical database.

## Goal

Build factual historical opening states for Lower Series without manually encoding careers or future outcomes.

The database should ultimately answer:

- which series existed in a given year;
- which entrants/teams were present;
- which drivers were entered for those teams;
- optional car number / rounds / replacement information;
- source provenance for every imported fact.

The Save World remains authoritative after New Game begins.

## Important current-state findings

### 1. The game has team infrastructure, but no real Lower Series team catalogue yet

The converter already understands a lower_series_teams sheet and the runtime loads lower_series_teams.json, but the canonical repo has no populated historical catalogue.

lower_team_id therefore means a stable internal identity assigned after a real entrant/team has been normalised. It must not be pre-generated for imaginary teams.

Example only:

- raw source: West Surrey Racing
- canonical identity after validation: lt_XXXX
- historical entry: 1983 | British F3 | lt_XXXX | Ayrton Senna

The ID should survive spelling/sponsor-name changes when they represent the same organisation.

### 2. There is no lower_series_entries ingestion path yet

The current Excel converter/materialiser/load path supports lower_series_teams, but not lower_series_entries.

Before importing thousands of rows, LS9A should add one canonical path:

Excel/source dataset -> lower_series_entries.json -> Season Pack -> New Game LowerSeriesWorld

No UI or engine should parse external source pages directly.

### 3. Current runtime Series data and the experimental richer Series catalogue are not yet the same

The canonical repo currently exposes a small public/data/series.json catalogue. The DB2 work contains a richer historical series model.

Do not assign permanent entry/team identities against an unstable series mapping. Resolve the canonical series_id scheme first, or keep source rows raw until the new catalogue is approved.

---

# Source assessment

## Primary candidate: Racing Years

https://www.racingyears.com/

### Why it is unusually useful for this project

Racing Years models the exact entities we need:

- championships and seasons;
- drivers;
- entrants / teams;
- individual races;
- race results;
- qualifying;
- entry lists;
- car numbers;
- chassis.

Their own contribution guidelines specify race data in the form:

Position / Number / Driver / Entrant / Chassis / Time

That makes Entrant a first-class source field instead of forcing us to infer teams from driver career summaries.

Source documentation:
- FAQ: https://www.racingyears.com/faq
- Contributions: https://www.racingyears.com/contribution

The database is community maintained and moderated. Treat it as a very strong aggregation source, not infallible primary evidence.

### Entry-list proof of concept

1983 British Formula 3 Silverstone:

https://www.racingyears.com/race/1983_British_Formula_3_Silverstone

The page contains an Entry List with number, driver and entrant, including for example:

- Ayrton Senna — West Surrey Racing
- Martin Brundle — Eddie Jordan Racing
- Mario Hytten — Axxess Racing Team
- Davy Jones / Eric Lang — Murray Taylor Racing
- Johnny Dumfries — Associated Motoracing

This is almost exactly the shape needed for lower_series_entries.

### Team identity is also reusable

Championship team/entrant pages and team profiles make it possible to follow the same organisation across years and sometimes across series.

Examples:
- GP2 entrants: https://www.racingyears.com/championship-teams/GP2
- Formula 3000 entrants: https://www.racingyears.com/championship-teams/Formula_3000
- ART Grand Prix profile: https://www.racingyears.com/team/ART_Grand_Prix

This can help separate the display/entrant name in a given year from the canonical Lower Series team identity.

## Secondary/verification source: OldRacingCars

https://www.oldracingcars.com/

OldRacingCars is particularly valuable for historical F2/F3, where entrant names, chassis and individual race research matter.

Examples:
- European Formula 2 archive 1967–1984: https://www.oldracingcars.com/f2/
- British Formula 3 1983: https://www.oldracingcars.com/f3/uk/1983/
- 1983 Cadwell Park result with entrants: https://www.oldracingcars.com/f3/results/uk/1983/cadwell-park/

Use OldRacingCars as a corroboration/enrichment source for older material, especially when entrant identity is ambiguous.

---

# Preliminary coverage found on Racing Years

This is a source-availability audit, not a completeness guarantee for every race.

| Series family | Coverage observed | Assessment |
| --- | --- | --- |
| European Formula 2 | 1967–1984 | Strong; also covered deeply by OldRacingCars |
| International Formula 3000 | 1985–2004 | Strong continuous championship coverage |
| GP2 | 2005–2016 | Strong continuous coverage + entrant catalogue |
| FIA Formula 2 | 2009–2012, 2017–present | Strong |
| World Series by Nissan | 1998–2004 | Strong |
| Formula Renault 3.5 / World Series by Renault | 2005–2017 | Strong under Racing Years naming |
| European Formula 3 | 1975–1984, 2003–2018 | Strong for those eras |
| FIA Formula 3 | 2019–present | Strong |
| Japanese Formula 3 | 1979–2019 | Very strong continuous coverage |
| Super Formula Lights | 2020–present | Strong |
| Formula Regional European | 2019–present | Strong |
| Eurocup Formula Renault | many seasons incl. 1991–2020, but catalogue view has gaps | Needs year-by-year coverage check |
| Formula Abarth | 2010–2013 | Strong |
| Italian Formula 4 | 2014–present | Strong |
| British Formula 4 | 2015–present | Strong |
| British Formula 3 | large historical archive / entrant catalogue | Strong candidate; early-era year coverage needs exact audit |
| Formula Junior variants | present in Racing Years, but fragmented by national championship | Needs mapping/coverage audit |
| British Formula Ford | present in Racing Years | Needs exact year/entry-list audit |

Useful championship URLs:
- Formula 3000: https://www.racingyears.com/championship/Formula_3000
- GP2: https://www.racingyears.com/championship/GP2
- European F2: https://www.racingyears.com/championship/European_Formula_2
- European F3: https://www.racingyears.com/championship/European_Formula_3
- Japanese F3: https://www.racingyears.com/championship/Japanese_Formula_3
- World Series by Nissan: https://www.racingyears.com/championship/World_Series_by_Nissan
- World Series by Renault: https://www.racingyears.com/championship/World_Series_by_Renault
- Formula Regional European: https://www.racingyears.com/championship/Formula_Regional_European
- Italian F4: https://www.racingyears.com/championship/Italian_Formula_4
- British F4: https://www.racingyears.com/championship/British_Formula_4
- Super Formula Lights: https://www.racingyears.com/championship/Super_Formula_Lights
- Formula Abarth: https://www.racingyears.com/championship/Formula_Abarth
- Eurocup Formula Renault: https://www.racingyears.com/championship/Eurocup_Formula_Renault

---

# Recommended data model

Do not ingest a website directly into canonical IDs in one step.

## Stage A — raw sourced facts

Working/import layer:

- source
- source_url
- year
- series_source_name
- event_or_round
- car_no
- driver_name_raw
- entrant_name_raw
- optional chassis_raw
- optional notes

This preserves exactly what the archive says.

## Stage B — identity resolution

Resolve separately:

- series_source_name -> series_id
- driver_name_raw -> driver_id
- entrant_name_raw -> lower_team_id

Unresolved names remain unresolved. Never invent a driver ID or silently merge two similarly named teams.

## Stage C — canonical facts

### lower_series_teams

Suggested minimum:

- lower_team_id
- team_name
- series_id
- valid_from
- valid_to
- source_url

Potential later alias table if renames/sponsor identities require it.

### lower_series_entries

Suggested minimum:

- year
- series_id
- lower_team_id
- driver_id
- driver_name
- car_no
- rounds
- source_url

driver_name remains useful provenance even after driver_id is resolved.

A season can contain multiple rows for the same car/team if a replacement happened mid-season. rounds preserves that fact without inventing one season driver.

---

# What not to do

- Do not create lower_team_id values before a real team/entrant exists in a source.
- Do not treat sponsor-name strings as automatically distinct organisations.
- Do not hard-code historical line-ups in React or the simulation engine.
- Do not use future historical entries after New Game starts.
- Do not make driver_career the source of opening Lower Series line-ups.
- Do not bulk scrape Racing Years until Terms/robots/acceptable-use have been reviewed. No public API was identified in this initial audit.

---

# Recommended next implementation

## LS9A — factual entry pipeline

1. Add lower_series_entries to Excel converter.
2. Add lower_series_entries.json to runtime loading.
3. Pass it through Season Packs.
4. New Game materialises only the chosen season's factual entries.
5. Match existing d_XXXX where possible.
6. Keep unresolved driver/team names visible in validation output rather than fabricating IDs.
7. Add coverage report: year x series -> entries / teams / unresolved names.

## LS9B — source adapter prototype

Before mass population, prove the workflow with three structurally different seasons:

- 1967 European F2 — Racing Years + OldRacingCars cross-check;
- 1983 British F3 — excellent entry-list evidence and Senna/Brundle test case;
- 2007 GP2 — modern multi-team/mid-season replacement case.

If those three import correctly into New Game and survive a season rollover, scale the dataset.

---

# Key conclusion

Racing Years changes the feasibility of this project substantially.

We do not need to hand-author every Lower Series team and driver relationship. The archive already contains the entrant/driver relationship at race level for at least a large part of the target eras.

The engineering task is now mostly:

source extraction -> identity normalisation -> canonical facts -> New Game materialisation

rather than manual historical reconstruction.