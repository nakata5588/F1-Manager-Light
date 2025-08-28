# F1 Manager Light — JSON Pack

A clean, GitHub‑ready bundle containing:
- **/data**: normalized JSONs (drivers, teams, staff, tracks, calendar 1980, rules/era, attributes dictionaries, etc.).
- **/data/seeds**: gameplay seeds (events, inbox, sponsors).
- **/scripts**: helpers to validate and (optionally) ingest a single Excel file into JSONs.
- **/src**: minimal loader utilities (JS) that read the JSONs.

> Drop your existing React project here or start fresh. Commit and push to GitHub.

## Quick Start
1. Unzip this package.
2. (Optional) Put your Excel file at the repo root as `database.xlsx`.
3. Run the Excel→JSON export:
   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r scripts/requirements.txt
   python scripts/ingest_xlsx_to_json.py
   ```
4. Validate:
   ```bash
   npm i ajv
   node scripts/validate_json.js
   ```
5. Commit and push:
   ```bash
   git init
   git add .
   git commit -m "feat: initial JSON pack for F1 Manager Light"
   git branch -M main
   git remote add origin <YOUR_GITHUB_REPO_URL>
   git push -u origin main
   ```

## Data Contracts (IDs are stable)
- `driver_id`: string (e.g., `D_0001`) + `slug` (e.g., `alan_jones`).
- `team_id`: string stable across renames (e.g., `T_WILLIAMS`).
- `track_id`: string (e.g., `TR_ARGENTINA_BUENOS_AIRES_1980`).
- `season`: number (e.g., `1980`).
- `round`: 1-based index.

All JSONs are arrays except `attributes.json` and dictionaries which are maps.
