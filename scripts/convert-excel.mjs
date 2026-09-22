// scripts/convert-excel.mjs
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const ROOT = process.cwd();
const SRC_XLSX = process.env.DB_XLSX || path.join(ROOT, "data", "f1_db.xlsx");
const OUT_DIR = path.join(ROOT, "public", "data"); // único output

// ---------- Utils ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function deleteIfExists(p) { if (fs.existsSync(p)) fs.unlinkSync(p); }

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
function slug(s) {
  return String(s ?? "")
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function readHeader(ws) {
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    headers.push(String(cell?.value ?? "").trim());
  });
  return headers;
}

function isEmptyRow(row) {
  const values = row.values || [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v != null && String(v).trim() !== "") return false;
  }
  return true;
}

/** Converte Excel date-like p/ ISO (yyyy-mm-dd). NÃO usar para colunas que só têm ano. */
function toISO(dateLike) {
  if (!dateLike) return null;
  if (dateLike instanceof Date) {
    const d = new Date(Date.UTC(
      dateLike.getUTCFullYear(),
      dateLike.getUTCMonth(),
      dateLike.getUTCDate()
    ));
    return d.toISOString().slice(0, 10);
  }
  if (typeof dateLike === "number") {
    const base = new Date(Date.UTC(1899, 11, 30)); // Excel 1900
    const ms = dateLike * 86400000;
    return new Date(base.getTime() + ms).toISOString().slice(0, 10);
  }
  if (typeof dateLike === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
    const t = Date.parse(dateLike);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * DETEÇÃO genérica de colunas de data (para outras sheets).
 * IMPORTANTE: NÃO inclui contract_until/contract_end para evitar inventar datas.
 */
function looksLikeDateHeader(h) {
  const n = norm(h);
  return (
    n.includes("date") ||
    n.endsWith("dob") ||
    n.endsWith("_dt") ||
    n.endsWith("_iso") ||
    n.includes("racedate") ||
    n.includes("nascimento") ||
    n.includes("falecimento")
  );
}

function cleanHeader(h) {
  if (!h || /^Unnamed:\s*\d+$/i.test(h) || h === "-") return null;
  return h;
}

function parseMaybe(val) {
  if (val === null || val === undefined) return undefined;
  if (typeof val !== "string") return val;
  const s = val.trim();
  if (!s) return undefined;
  // JSON?
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try { return JSON.parse(s); } catch {}
  }
  // CSV
  if (s.includes(";")) return s.split(";").map(x => x.trim()).filter(Boolean);
  if (s.includes(",")) return s.split(",").map(x => x.trim()).filter(Boolean);
  // boolean
  if (s.toLowerCase() === "true") return true;
  if (s.toLowerCase() === "false") return false;
  // número
  const num = Number(s);
  if (!Number.isNaN(num) && String(num) === s) return num;
  return s;
}

/** Normaliza um ano: aceita 2004, "2004", 4, "04" → 2004; 88 → 1988; retorna null se inválido. */
function normalizeYear(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n >= 1000) return n;       // já é ano completo
  if (n < 0) return null;
  if (n < 50) return 2000 + n;   // "04" → 2004
  if (n < 100) return 1900 + n;  // "88" → 1988
  return null;
}

/** Converte em número ou null. */
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToObjExpanded(row, headers, cfg) {
  const obj = {};
  headers.forEach((h, idx) => {
    if (!h) return;
    let v = row.getCell(idx + 1)?.value;
    if (v && typeof v === "object" && "text" in v) v = v.text;
    // só auto-converter para ISO quando o header parece data (contratos NÃO entram aqui)
    if (v instanceof Date) v = toISO(v);
    if (typeof v === "number" && looksLikeDateHeader(h)) {
      const iso = toISO(v);
      if (iso) v = iso;
    }
    obj[h] = v;
  });

  // Mapear colunas canónicas
  if (cfg?.columns) {
    for (const [canonical, variants] of Object.entries(cfg.columns)) {
      let found = null;
      for (const cand of variants) {
        if (obj[cand] != null && obj[cand] !== "") { found = obj[cand]; break; }
      }
      if (found != null) obj[canonical] = found;
    }
  }

  // Post-processar
  if (cfg?.post) {
    const out = cfg.post(obj);
    // remover undefined para JSON limpinho
    Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
    return out;
  }
  Object.keys(obj).forEach(k => obj[k] === undefined && delete obj[k]);
  return obj;
}

// ---------- Config por sheet ----------
const SHEET_CONFIG = {
  // === folhas já existentes (ajusta conforme o teu Excel) ===
  drivers: {
    out: "drivers.json",
    columns: {
      id: ["driver_id","id","codigo","cod"],
      name: ["display_name","name","fullname","full_name","driver_name"],
      nationality: ["country_name","country","nationality","nat","country_code"],
      birthdate: ["dob","birthdate","data_nascimento","data_nasc"],
      portrait_path: ["portrait_path","portrait","photo","image","img"],
      helmet_color_primary: ["helmet_color_primary"],
      helmet_color_secondary: ["helmet_color_secondary"],
      prefered_number: ["prefered_number","preferred_number","race_number","number"],
      status: ["status"],
      active_1980: ["1980","active_1980","activein1980"],
    },
    post(row) {
      row.birthdate_iso = toISO(row.birthdate) ?? toISO(row.dob) ?? null;
      if ("dob" in row && !row.birthdate) row.birthdate = row.dob;
      if (row.prefered_number != null) row.prefered_number = Number(row.prefered_number);
      if (typeof row.active_1980 === "string") {
        row.active_1980 = row.active_1980.trim().toLowerCase() === "true";
      } else if (row.active_1980 != null) {
        row.active_1980 = Boolean(row.active_1980);
      }
      return row;
    }
  },

  driver_ratings: {
    out: "driver_ratings.json",
    columns: {
      year: ["year","ano"],
      driver_id: ["driver_id","id"],
      driver_name: ["driver_name","display_name","name"],
      current_ability: ["current_ability","overall","rating","ovr"],
      potential_ability: ["potential_ability","pa"],
    }
  },

  driver_career: {
    out: "driver_career.json",
    columns: {
      driver_id: ["driver_id","id"],
      driver_name: ["driver_name","name","display_name"],
      year: ["year"],
      series_division: ["series_division","division","series"],
      team_id: ["team_id"],
      team_name: ["team_name","team"],
      races: ["races","starts"],
      wins: ["wins"],
      podiums: ["podiums","podios"],
      poles: ["poles","pole_positions"],
      fastest_laps: ["fastest_laps"],
      points: ["points"],
      champ_pos: ["champ_pos","championship_position","position"],
      order: ["order","sort"]
    }
  },

  staff_core: {
    out: "staff_core.json",
    columns: {
      staff_id: ["staff_id","id"],
      staff_name: ["staff_name","name","display_name"],
      country_name: ["country_name","nationality","country"],
      role_id: ["role_id","role","cargo"]
    }
  },

  staff_ratings: {
    out: "staff_ratings.json",
    columns: {
      year: ["year"],
      staff_id: ["staff_id","id"],
      staff_name: ["staff_name","name","display_name"],
    }
  },

  teams: {
    out: "teams.json",
    columns: {
      team_id: ["team_id","id","constructor_id"],
      team_name: ["team_name","name","official_name","oficial_name","equipa"],
      team_base: ["team_base","base","hq","headquarters","city","location"]
    },
    post(row) {
      if (!row.short_name && row.team_name) {
        row.short_name = String(row.team_name).split(" ")[0];
      }
      return row;
    }
  },

  team_brands: { out: "team_brands.json" },
  team_engines: { out: "team_engines.json" },

  car_stats_by_year: {
    out: "car_stats_by_year.json",
    columns: {
      team_id: ["team_id","constructor_id","team"],
      year: ["year","season","ano"]
    }
  },
  pitcrew_roster: {
    out: "pitcrew_roster.json",
    columns: {
      team_id: ["team_id","constructor_id","team"],
      year: ["year","season","ano"]
    }
  },
  drivers_status: { out: "drivers_status.json" },
  driver_growth: { out: "driver_growth.json" },
  car_parts: { out: "car_parts.json" },
  facilities_catalog: { out: "facilities_catalog.json" },
  rd_projects: { out: "rd_projects.json" },
  weather_profiles: { out: "weather_profiles.json" },
  finance_ledger: { out: "finance_ledger.json" },
  events: { out: "events.json" },
  event_templates: { out: "event_templates.json" },
  news_template: { out: "news_template.json" },
  achievements: { out: "achievements.json" },

  // === CONTRATOS (corrigido para usar apenas anos) ===
  contracts: {
    out: "contracts.json",
    columns: {
      year: ["year","season","ano"],
      team_id: ["team_id","constructor_id","team"],
      team_name: ["team_name","team"],
      driver_id: ["driver_id","id"],
      driver_name: ["driver_name","display_name","name"],
      role: ["role","driver_role","papel"],
      driver_number: ["driver_number","number","race_number"],
      salary: ["salary","base_salary"],
      bonus_win: ["bonus_win","win_bonus"],
      bonus_podium: ["bonus_podium","podium_bonus"],
      bonus_championship: ["bonus_championship","championship_bonus","title_bonus"],
      // Na tua base só tens ANOS — mapeamos como tal:
      contract_start: ["contract_start","start","start_year","from","inicio"],
      contract_until: ["contract_until","end","end_year","to","fim"]
    },
    post(row) {
      const startY = normalizeYear(row.contract_start ?? row.start_year ?? row.from ?? row.year);
      const endY   = normalizeYear(row.contract_until ?? row.end_year ?? row.to ?? row.year);

      const out = {
        year: normalizeYear(row.year) ?? null,
        team_id: row.team_id,
        team_name: row.team_name,
        driver_id: row.driver_id,
        driver_name: row.driver_name,
        role: row.role,
        driver_number: numOrNull(row.driver_number),
        salary: numOrNull(row.salary),
        bonus_win: numOrNull(row.bonus_win),
        bonus_podium: numOrNull(row.bonus_podium),
        bonus_championship: numOrNull(row.bonus_championship),
        // Exportar apenas anos:
        contract_start_year: startY,
        contract_until_year: endY,
        // Campo opcional para ordenação no UI (fim do ano)
        contract_end_sort: endY ? `${endY}-12-31` : (startY ? `${startY}-12-31` : null)
      };

      // Não exportar quaisquer datas completas (para evitar 1905-06-xx, etc.)
      delete out.contract_end;
      delete out.contract_end_iso;

      return out;
    }
  },

  core_tracks: {
    out: "core_tracks.json",
    columns: {
      track_id: ["track_id","circuit_id","id"],
      track_name: ["track_name","name","circuit_name"],
      country: ["country","pais","país","location"]
    }
  },

  calendar: {
    out: "calendar.json",
    columns: {
      year: ["year","season"],
      round: ["round","rd"],
      gp_name: ["gp_name","name","gp","race","grand_prix","grande_premio"],
      gp_id: ["gp_id","id","race_id"],
      track_id: ["track_id","circuit_id","track"],
      race_date: ["race_date","date","data"]
    },
    post(row) {
      row.dateISO = toISO(row.race_date) ?? toISO(row.date) ?? null;
      if (!row.country && row.Country) row.country = row.Country;
      return row;
    }
  },

  race_results: {
    out: "race_results.json",
    columns: {
      year: ["year"],
      round: ["round"],
      gp_name: ["gp_name","race","name"],
      gp_id: ["gp_id","race_id","id"],
      track_id: ["track_id","circuit_id"],
      race_date: ["race_date","date"],
      driver_id: ["driver_id","id"],
      driver_name: ["driver_name","name","display_name"],
    },
    post(row) {
      row.dateISO = toISO(row.race_date) ?? null;
      return row;
    }
  },

  core_engines: {
    out: "core_engines.json",
    columns: {
      engine_id: ["engine_id","id"],
      engine_name: ["engine_name","name"],
      aspiration: ["aspiration"]
    }
  },

  core_sponsors_catalog: {
    out: "core_sponsors_catalog.json",
    columns: {
      sponsor_id: ["sponsor_id","id"],
      sponsor_name: ["sponsor_name","sposor_name","name"],
      industry: ["industry","sector"]
    }
  },

  sponsors_contracts: {
    out: "sponsors_contracts.json",
    columns: {
      year: ["year"],
      team_id: ["team_id"],
      team_name: ["team_name"],
      sponsor_id: ["sponsor_id"],
      sponsor_name: ["sponsor_name","name"],
      tier: ["tier"],
      duration_years: ["duration_years","duration"]
    }
  },

  rules: {
    out: "rules.json",
    columns: {
      year: ["year"],
      points_system: ["points_system","points"],
      fastest_lap_points: ["fastest_lap_points","fl_points"],
      currency: ["currency","moeda"]
    }
  },

  qualifying_rules: {
    out: "qualifying_rules.json",
    columns: {
      year: ["Year","year"],
      sessions: ["Sessions","sessions"],
      length: ["Length","length"],
      rule: ["Rule","rule"]
    }
  },

  era_safety: {
    out: "era_safety.json",
    columns: {
      year: ["year"],
      era_safety_index: ["era_safety_index"],
      car_safety: ["car_safety"],
      medical_response: ["medical_response"],
      marshals_quality: ["marshals_quality"]
    }
  },

  accident_model: {
    out: "accident_model.json",
    columns: {
      year: ["year"],
      minor_prob: ["minor_prob"],
      damage_DNF_prob: ["damage_DNF_prob","damage_dnf_prob"],
      injury_prob: ["injury_prob"],
      fatality_prob: ["fatality_prob"]
    }
  },

  core_driver_attributes: { out: "core_driver_attributes.json" },
  core_staff_attributes: { out: "core_staff_attributes.json" },
  core_roles: { out: "core_roles.json" },

  Series: {
    out: "series.json",
    columns: {
      series_id: ["series_id","id"],
      series_division: ["series_division","division"],
      series_short_name: ["series_short_name","short_name","short"],
      series_name: ["series_name","name","title"]
    }
  },

  driver_attribute_weights: {
    out: "driver_attribute_weights.json",
    columns: {
      attribute: ["attribute","key","attr"],
    }
  },

  // ======= NOVAS ABAS =======
  tyres_catalog: {
    out: "tyres_catalog.json",
    columns: {
      tyre_id: ["tyre_id","id"],
      year_from: ["year_from","from"],
      year_to: ["year_to","to"],
      supplier: ["supplier","brand"],
      compound_name: ["compound_name","compound","name"],
      category: ["category","type"],
      grip_index: ["grip_index","grip"],
      wear_rate: ["wear_rate","wear"],
      warmup_time_s: ["warmup_time_s","warmup","warmup_s"],
      wet_efficiency: ["wet_efficiency","wet_eff"],
      notes: ["notes","obs","observations"]
    }
  },

  points_systems: {
    out: "points_systems.json",
    columns: {
      points_system_id: ["points_system_id","id"],
      year_from: ["year_from","from"],
      year_to: ["year_to","to"],
      places_csv: ["places_csv","places"],
      fastest_lap_bonus: ["fastest_lap_bonus","fl_bonus"],
      pole_bonus: ["pole_bonus"],
      notes: ["notes"]
    }
  },

  penalties_rules: {
    out: "penalties_rules.json",
    columns: {
      rule_id: ["rule_id","id"],
      year_from: ["year_from","from"],
      year_to: ["year_to","to"],
      type: ["type"],
      trigger: ["trigger","reason"],
      value: ["value"],
      units: ["units"],
      applies_to: ["applies_to","target"],
      during: ["during","scope"],
      notes: ["notes"]
    }
  },

  financial_rules: {
    out: "financial_rules.json",
    columns: {
      year_from: ["year_from","from"],
      year_to: ["year_to","to"],
      currency: ["currency"],
      min_salary_driver: ["min_salary_driver"],
      max_salary_driver: ["max_salary_driver"],
      min_salary_staff: ["min_salary_staff"],
      max_salary_staff: ["max_salary_staff"],
      prize_money_per_point: ["prize_money_per_point","prize_per_point"],
      win_bonus: ["win_bonus"],
      pole_bonus: ["pole_bonus"],
      fastest_lap_bonus: ["fastest_lap_bonus"],
      notes: ["notes"]
    }
  },

  board_goals_templates: {
    out: "board_goals_templates.json",
    columns: {
      template_id: ["template_id","id"],
      team_tier: ["team_tier","tier"],
      season_goals_json: ["season_goals_json","season_goals"],
      penalties_json: ["penalties_json","penalties"],
      bonuses_json: ["bonuses_json","bonuses"]
    },
    post(row) {
      // parse JSON-like columns
      row.season_goals = parseMaybe(row.season_goals_json);
      row.penalties = parseMaybe(row.penalties_json);
      row.bonuses = parseMaybe(row.bonuses_json);
      return row;
    }
  },

  agenda_blocks: {
    out: "agenda_blocks.json",
    columns: {
      block_id: ["block_id","id"],
      name: ["name","title"],
      allowed_days_csv: ["allowed_days_csv","allowed_days"],
      duration_h: ["duration_h","duration","hours"],
      slot_type: ["slot_type","type"],
      effects_json: ["effects_json","effects"],
      cooldown_days: ["cooldown_days","cooldown"]
    },
    post(row) {
      row.allowed_days = parseMaybe(row.allowed_days_csv);
      row.effects = parseMaybe(row.effects_json);
      return row;
    }
  },

  logos_index: {
    out: "logos_index.json",
    columns: {
      team_id: ["team_id","id"],
      year_from: ["year_from","from"],
      year_to: ["year_to","to"],
      path_rel: ["path_rel","path","logo_path"]
    }
  },

  ai_difficulty: {
    out: "ai_difficulty.json",
    columns: {
      level_id: ["level_id","id"],
      label: ["label","name"],
      driver_attr_multiplier: ["driver_attr_multiplier"],
      team_budget_multiplier: ["team_budget_multiplier"],
      strategy_error_prob: ["strategy_error_prob"],
      ai_overtake_bias: ["ai_overtake_bias"],
      ai_defense_bias: ["ai_defense_bias"],
      pit_error_mult: ["pit_error_mult"]
    }
  },

  contract_rules: {
    out: "contract_rules.json",
    columns: {
      year_from: ["year_from","from"],
      year_to: ["year_to","to"],
      buyout_allowed: ["buyout_allowed"],
      options_allowed_csv: ["options_allowed_csv","options_allowed"],
      min_length_y: ["min_length_y","min_length"],
      max_length_y: ["max_length_y","max_length"],
      max_drivers_contracts: ["max_drivers_contracts","max_drivers"],
      clauses_json: ["clauses_json","clauses"]
    },
    post(row) {
      row.options_allowed = parseMaybe(row.options_allowed_csv);
      row.clauses = parseMaybe(row.clauses_json);
      return row;
    }
  },

  youth_intake_rules: {
    out: "youth_intake_rules.json",
    columns: {
      year_from: ["year_from","from"],
      year_to: ["year_to","to"],
      regions_csv: ["regions_csv","regions"],
      min_age: ["min_age"],
      max_age: ["max_age"],
      n_candidates: ["n_candidates","candidates"],
      attr_min: ["attr_min","min_attr"],
      attr_max: ["attr_max","max_attr"],
      hidden_gem_prob: ["hidden_gem_prob","gem_prob"]
    },
    post(row) {
      row.regions = parseMaybe(row.regions_csv);
      return row;
    }
  },

  scouting_zones: {
    out: "scouting_zones.json",
    columns: {
      zone_id: ["zone_id","id"],
      name: ["name","zone_name","title"],
      countries_csv: ["countries_csv","countries"],
      cost_per_week: ["cost_per_week","cost_week"],
      talent_boost: ["talent_boost","boost"],
      travel_time_days: ["travel_time_days","travel_days"]
    },
    post(row) {
      row.countries = parseMaybe(row.countries_csv);
      return row;
    }
  },

  track_layout_by_year: {
    out: "track_layout_by_year.json",
    columns: {
      track_id: ["track_id","id","circuit_id"],
      year_from: ["year_from","from"],
      year_to: ["year_to","to"],
      laps: ["laps"],
      lap_length_km: ["lap_length_km","lap_km","length_km"],
      drs_zones: ["drs_zones","drs"],
      pit_lane_loss_s: ["pit_lane_loss_s","pit_lane_loss","pit_loss_s"]
    }
  },
  // ===== Ratings V2 / Historical R2B =====
  driver_rating_profiles: { out: "driver_rating_profiles.json" },
  driver_year_status: { out: "driver_year_status.json" },
  driver_opening_state: { out: "driver_opening_state.json" },
  historical_rating_snapshots: { out: "historical_rating_snapshots.json" },
  driver_development_history: { out: "driver_development_history.json" },
  driver_availability_history: { out: "driver_availability_history.json" },
  driver_team_history: { out: "driver_team_history.json" },
  f1_entry_list_history: { out: "f1_entry_list_history.json" },
  team_engine_history: { out: "team_engine_history.json" },
  car_competitiveness_by_year: { out: "car_competitiveness_by_year.json" },
  season_reference_1980_1985: { out: "season_reference_1980_1985.json" },
  historical_source_registry: { out: "historical_source_registry.json" },
  rating_model_R2: { out: "rating_model_R2.json" },
  peak_floor_review_R2: { out: "peak_floor_review_R2.json" },
  canonical_patch_R2: { out: "canonical_patch_R2.json" },
  canonical_qa: { out: "canonical_qa.json" },

};

// ---------- Pipeline ----------
async function processSheet(ws, cfg) {
  const rawHeaders = readHeader(ws);
  const headers = rawHeaders.map(cleanHeader).map((h, i) => h ?? `col_${i+1}`);
  const dropIdx = rawHeaders.map((h, i) => cleanHeader(h) ? null : i);

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (isEmptyRow(row)) continue;
    let obj = rowToObjExpanded(row, headers, cfg);
    for (const di of dropIdx) {
      if (di != null) delete obj[`col_${di+1}`];
    }
    rows.push(obj);
  }
  return rows;
}

async function main() {
  if (!fs.existsSync(SRC_XLSX)) {
    console.error(`[convert-excel] Excel not found at: ${SRC_XLSX}`);
    process.exit(1);
  }
  ensureDir(OUT_DIR);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC_XLSX);

  // índice de folhas existentes
  const wsByName = {};
  for (const ws of wb.worksheets) wsByName[ws.name] = ws;
  console.log(`[convert-excel] Sheets in workbook: ${Object.keys(wsByName).join(", ")}`);

  // correr apenas as folhas do SHEET_CONFIG; apagar outputs quando faltarem
  const results = [];
  for (const [sheetName, cfg] of Object.entries(SHEET_CONFIG)) {
    const outName = cfg?.out || `${slug(sheetName)}.json`;
    const outPath = path.join(OUT_DIR, outName);

    const ws = wsByName[sheetName];
    if (!ws) {
      // apagar se existir
      deleteIfExists(outPath);
      console.warn(`[convert-excel] Sheet "${sheetName}" NOT FOUND → deleted ${outName} if it existed.`);
      continue;
    }

    const rows = await processSheet(ws, cfg);
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf8");
    results.push({ outName, count: rows.length });
    console.log(`[convert-excel] Wrote ${outName} (${rows.length} rows)`);
  }

  // relatório curto
  const total = results.reduce((a, r) => a + r.count, 0);
  console.log(`[convert-excel] Done. ${results.length} files written, ${total} rows total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
