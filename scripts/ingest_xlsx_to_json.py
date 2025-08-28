# Ingest an Excel workbook (database.xlsx) and export normalized JSON files into /data.
# Expected sheet names (customize as needed):
#   - drivers, teams, staff, tracks, calendar, attributes, rules, seeds_inbox, seeds_events

import pandas as pd
import json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCEL_PATH = ROOT / "database.xlsx"
OUT_DIR = ROOT / "data"
SEEDS_DIR = OUT_DIR / "seeds"

OUT_DIR.mkdir(parents=True, exist_ok=True)
SEEDS_DIR.mkdir(parents=True, exist_ok=True)

def to_json(df: pd.DataFrame):
    return json.loads(df.to_json(orient="records", date_format="iso"))

def write_json(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_sheet(xl, name, out_name=None):
    if name not in xl.sheet_names:
        print(f"[WARN] Sheet '{name}' not found; skipping.")
        return
    df = xl.parse(name)
    data = to_json(df)
    write_json(OUT_DIR / (out_name or f"{name}.json"), data)
    print(f"[OK] Wrote {out_name or name}.json ({len(data)} records)")

def main():
    if not EXCEL_PATH.exists():
        print(f"[ERROR] Excel file not found at {EXCEL_PATH}. Put your file there and rerun.")
        sys.exit(1)

    xl = pd.ExcelFile(EXCEL_PATH)

    load_sheet(xl, "drivers")
    load_sheet(xl, "teams")
    load_sheet(xl, "staff")
    load_sheet(xl, "tracks")
    load_sheet(xl, "calendar", "calendar_1980.json")
    load_sheet(xl, "rules", "rules_1980.json")
    load_sheet(xl, "attributes", "attributes.json")

    if "seeds_inbox" in xl.sheet_names:
        df = xl.parse("seeds_inbox")
        write_json(SEEDS_DIR / "inbox_seed.json", to_json(df))
        print(f"[OK] Wrote seeds/inbox_seed.json ({len(df)} records)")
    if "seeds_events" in xl.sheet_names:
        df = xl.parse("seeds_events")
        write_json(SEEDS_DIR / "events_seed.json", to_json(df))
        print(f"[OK] Wrote seeds/events_seed.json ({len(df)} records)")

if __name__ == "__main__":
    main()
