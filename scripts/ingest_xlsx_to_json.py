# -*- coding: utf-8 -*-
"""
Ingest a 'database.xlsx' and export normalized JSONs into /data.
Adaptado para os teus nomes de folhas:
- driver_core, driver_ratings, contracts
- teams_core, staff_core, core_tracks
- calendar, rules
- core_driver_attributes, core_staff_attributes

Robusto a:
- 'year' vs 'season'
- ids maiúsculas/minúsculas
- colunas extra (mantém)
"""

import json
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "database.xlsx"
OUT = ROOT / "data"
OUT_SEEDS = OUT / "seeds"
OUT.mkdir(parents=True, exist_ok=True)
OUT_SEEDS.mkdir(parents=True, exist_ok=True)

TARGET_SEASON = 1980  # muda se precisares

def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, default=str)

def to_records(df: pd.DataFrame):
    # NaN -> None
    return json.loads(df.to_json(orient="records", date_format="iso"))

def get_col(df, *names, default=None):
    for n in names:
        if n in df.columns:
            return df[n]
    return default

def has_cols(df, *cols):
    return all(c in df.columns for c in cols)

def norm_id(x):
    if pd.isna(x):
        return None
    return str(x).strip()

def detect_season_col(df):
    if "season" in df.columns: return "season"
    if "Season" in df.columns: return "Season"
    if "year"   in df.columns: return "year"
    if "Year"   in df.columns: return "Year"
    return None

def load_excel(xlsx: Path):
    if not xlsx.exists():
        raise SystemExit(f"[ERROR] Excel file not found at {xlsx}")
    return pd.ExcelFile(xlsx)

def export_teams(xl):
    if "teams_core" not in xl.sheet_names:
        print("[WARN] 'teams_core' not found; skipping teams.")
        return
    df = xl.parse("teams_core")

    # criar name_common se não existir (vários fallbacks)
    if "name_common" not in df.columns:
        fallback_cols = [c for c in ["name_common","name","name_official","team_name"] if c in df.columns]
        if fallback_cols:
            df["name_common"] = df[fallback_cols[0]]
        else:
            # último recurso: usa team_id
            if "team_id" in df.columns:
                df["name_common"] = df["team_id"]

    write_json(OUT / "teams.json", to_records(df))
    print(f"[OK] teams.json ({len(df)})")

def export_staff(xl):
    if "staff_core" not in xl.sheet_names:
        print("[WARN] 'staff_core' not found; skipping staff.")
        return
    df = xl.parse("staff_core")
    write_json(OUT / "staff.json", to_records(df))
    print(f"[OK] staff.json ({len(df)})")

def export_tracks(xl):
    if "core_tracks" not in xl.sheet_names:
        print("[WARN] 'core_tracks' not found; skipping tracks.")
        return
    df = xl.parse("core_tracks")
    write_json(OUT / "tracks.json", to_records(df))
    print(f"[OK] tracks.json ({len(df)})")

def export_calendar(xl):
    if "calendar" not in xl.sheet_names:
        print("[WARN] 'calendar' not found; skipping calendar.")
        return
    df = xl.parse("calendar")
    # filtra por temporada, se existir
    s_col = detect_season_col(df)
    if s_col:
        df = df[df[s_col] == TARGET_SEASON].copy()
    write_json(OUT / f"calendar_{TARGET_SEASON}.json", to_records(df))
    print(f"[OK] calendar_{TARGET_SEASON}.json ({len(df)})")

def export_rules(xl):
    if "rules" not in xl.sheet_names:
        print("[WARN] 'rules' not found; skipping rules.")
        return
    df = xl.parse("rules")
    s_col = detect_season_col(df)
    if s_col:
        df_era = df[df[s_col] == TARGET_SEASON].copy()
        write_json(OUT / f"rules_{TARGET_SEASON}.json", to_records(df_era))
        print(f"[OK] rules_{TARGET_SEASON}.json ({len(df_era)})")
    # export total também (útil para debug/histórico)
    write_json(OUT / "rules_all.json", to_records(df))
    print(f"[OK] rules_all.json ({len(df)})")

def export_attributes_dicts(xl):
    if "core_driver_attributes" in xl.sheet_names:
        df = xl.parse("core_driver_attributes").copy()
        # tenta formar {key: description/label}
        if has_cols(df, "key", "label"):
            mapping = {str(k): str(v) for k, v in zip(df["key"], df["label"])}
        else:
            mapping = {str(i): to_records(df.iloc[[i]])[0] for i in range(len(df))}
        write_json(OUT / "attributes_driver.json", mapping)
        print(f"[OK] attributes_driver.json ({len(mapping)})")
    else:
        print("[WARN] 'core_driver_attributes' not found; skipping driver attributes.")

    if "core_staff_attributes" in xl.sheet_names:
        df = xl.parse("core_staff_attributes").copy()
        if has_cols(df, "key", "label"):
            mapping = {str(k): str(v) for k, v in zip(df["key"], df["label"])}
        else:
            mapping = {str(i): to_records(df.iloc[[i]])[0] for i in range(len(df))}
        write_json(OUT / "attributes_staff.json", mapping)
        print(f"[OK] attributes_staff.json ({len(mapping)})")
    else:
        print("[WARN] 'core_staff_attributes' not found; skipping staff attributes.")

def export_drivers(xl):
    missing = [s for s in ["driver_core", "driver_ratings", "contracts"] if s not in xl.sheet_names]
    if missing:
        print(f"[WARN] Missing {missing}; drivers export may be partial.")

    # base cores
    if "driver_core" not in xl.sheet_names:
        print("[WARN] 'driver_core' not found; skipping drivers.")
        return
    dc = xl.parse("driver_core").copy()
    if "full_name" not in dc.columns:
        # 1) tenta encontrar uma coluna de nome “único”
        source = None
        for cand in ["full_name", "name", "driver_name", "Nome", "nome", "fullName"]:
            if cand in dc.columns:
                source = cand
                break
        if source:
            dc["full_name"] = dc[source].astype(str).str.strip()
        else:
            # 2) construir a partir de first_name/last_name com defaults como Series vazias
            import pandas as pd
            fn = dc.get("first_name", pd.Series([""] * len(dc), index=dc.index))
            ln = dc.get("last_name",  pd.Series([""] * len(dc), index=dc.index))
            dc["full_name"] = (fn.fillna("").astype(str) + " " + ln.fillna("").astype(str)).str.strip()

    # se faltar first/last, tenta partir de full_name OU name
    if ("first_name" not in dc.columns) or ("last_name" not in dc.columns):
        source_name_col = "full_name" if "full_name" in dc.columns else ("name" if "name" in dc.columns else None)
        if source_name_col:
            split = dc[source_name_col].astype(str).str.strip().str.split(r"\s+", n=1, regex=True)
            if "first_name" not in dc.columns:
                dc["first_name"] = split.str[0]
            if "last_name" not in dc.columns:
                dc["last_name"] = split.str[1].fillna("")

    # normaliza id
    id_col = "driver_id" if "driver_id" in dc.columns else ("id" if "id" in dc.columns else None)
    if not id_col:
        print("[ERROR] driver_core doesn't have 'driver_id' / 'id'.")
        return
    dc[id_col] = dc[id_col].map(norm_id)

    # ratings 1980 -> dict por driver_id em subobjeto "attributes"
    attrs_map = {}
    if "driver_ratings" in xl.sheet_names:
        dr = xl.parse("driver_ratings").copy()
        s_col = detect_season_col(dr)
        if s_col:
            dr = dr[dr[s_col] == TARGET_SEASON].copy()
        # tenta usar coluna de chave do driver
        dr_id_col = "driver_id" if "driver_id" in dr.columns else ("id" if "id" in dr.columns else None)
        if dr_id_col:
            dr[dr_id_col] = dr[dr_id_col].map(norm_id)
            # quais colunas são atributos? (numéricas/booleans, exclui id e season/year)
            drop_cols = {dr_id_col, "season", "Season", "year", "Year"}
            attr_cols = [c for c in dr.columns if c not in drop_cols]
            for _, row in dr.iterrows():
                did = row[dr_id_col]
                if not did: 
                    continue
                attrs_map[did] = {c: (None if pd.isna(row[c]) else row[c]) for c in attr_cols}
        else:
            print("[WARN] driver_ratings has no driver_id/id; skipping attributes.")
    else:
        print("[WARN] 'driver_ratings' not found; skipping attributes.")

    # contratos para season 1980 -> team_id
    team_map = {}
    if "contracts" in xl.sheet_names:
        ct = xl.parse("contracts").copy()
        s_col = detect_season_col(ct)
        if s_col:
            ct = ct[ct[s_col] == TARGET_SEASON].copy()
        # tenta detectar colunas comuns
        # driver key pode estar como driver_id ou person_id
        cand_driver_cols = [c for c in ["driver_id", "person_id", "id"] if c in ct.columns]
        team_col = "team_id" if "team_id" in ct.columns else ("team" if "team" in ct.columns else None)
        if cand_driver_cols and team_col:
            dcol = cand_driver_cols[0]
            ct[dcol] = ct[dcol].map(norm_id)
            ct[team_col] = ct[team_col].map(norm_id)
            # se person_id tiver prefixos, não filtramos; mapeamos tudo que existir
            for _, row in ct.iterrows():
                did = row[dcol]
                tid = row[team_col]
                if did and tid:
                    team_map[did] = tid
        else:
            print("[WARN] contracts missing id/team columns; skipping team mapping.")
    else:
        print("[WARN] 'contracts' not found; skipping team mapping.")

    # compõe saída de drivers
    out = []
    for _, row in dc.iterrows():
        did = row[id_col]
        base = {k: (None if pd.isna(v) else v) for k, v in row.to_dict().items()}
        base["driver_id"] = did  # garante nome padronizado
        if "id" in base and id_col != "id":
            base.pop("id", None)
        # junta team_id se existir em contracts
        if did in team_map:
            base["team_id"] = team_map[did]
        # junta attributes se existir
        if did in attrs_map:
            base["attributes"] = attrs_map[did]
        out.append(base)

    write_json(OUT / "drivers.json", out)
    print(f"[OK] drivers.json ({len(out)})")

def main():
    xl = load_excel(XLSX)
    print("[INFO] Sheets:", xl.sheet_names)

    export_teams(xl)
    export_staff(xl)
    export_tracks(xl)
    export_calendar(xl)
    export_rules(xl)
    export_attributes_dicts(xl)
    export_drivers(xl)

if __name__ == "__main__":
    main()
