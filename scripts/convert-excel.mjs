// scripts/convert-excel.mjs
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const ROOT = process.cwd();
const SRC_XLSX = process.env.DB_XLSX || path.join(ROOT, "data", "f1_db.xlsx");
const OUT_DIR = path.join(ROOT, "public", "data");

// ---------- Utils ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

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
    // Excel 1900 date system (base 1899-12-30)
    const base = new Date(Date.UTC(1899, 11, 30));
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

function looksLikeDateHeader(h) {
  const n = norm(h);
  return (
    n.includes("date") ||
    n.endsWith("dob") ||
    n.endsWith("_dt") ||
    n.endsWith("_iso") ||
    n.includes("race_date") ||
    n.includes("contract_end") ||
    n.includes("contract_until") ||
    n.includes("nascimento") ||
    n.includes("falecimento")
  );
}

function cleanHeader(h) {
  if (!h || /^Unnamed:\s*\d+$/i.test(h) || h === "-" ) return null;
  return h;
}

/**
 * rowToObjExpanded
 * - parte de TODAS as colunas originais (pass-through)
 * - aplica renomes/synonyms para gerar chaves canónicas (sem perder as originais)
 * - normaliza datas
 */
function rowToObjExpanded(row, headers, cfg) {
  const obj = {};
  // 1) Pass-through das colunas originais
  headers.forEach((h, idx) => {
    if (!h) return;
    let v = row.getCell(idx + 1)?.value;
    if (v && typeof v === "object" && "text" in v) v = v.text;
    if (v instanceof Date) v = toISO(v);
    if (typeof v === "number" && looksLikeDateHeader(h)) {
      const iso = toISO(v);
      if (iso) v = iso;
    }
    obj[h] = v;
  });

  // 2) Renomes/synonyms → canónicas (não remove as originais)
  if (cfg?.columns) {
    for (const [canonical, variants] of Object.entries(cfg.columns)) {
      let found = null;
      for (const cand of variants) {
        if (obj[cand] != null && obj[cand] !== "") { found = obj[cand]; break; }
      }
      if (found != null) obj[canonical] = found;
    }
  }

  // 3) Normalizações extras
  if (cfg?.post) return cfg.post(obj);
  return obj;
}

// ---------- Config por sheet (synonyms + normalizações) ----------
/**
 * Nota:
 * - Mantemos os nomes originais de coluna no JSON (pass-through).
 * - Adicionalmente criamos campos canónicos quando úteis (ex.: "id", "name", "dateISO"...).
 * - Se uma folha não estiver listada em SHEET_CONFIG, é processada genericamente.
 */
const SHEET_CONFIG = {
  // Drivers master
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
      // datas
      row.birthdate_iso = toISO(row.birthdate) ?? toISO(row.dob) ?? null;
      if ("dob" in row && !row.birthdate) row.birthdate = row.dob;
      // coerções
      if (row.prefered_number != null) row.prefered_number = Number(row.prefered_number);
      if (typeof row.active_1980 === "string") {
        row.active_1980 = row.active_1980.trim().toLowerCase() === "true";
      } else if (row.active_1980 != null) {
        row.active_1980 = Boolean(row.active_1980);
      }
      return row;
    }
  },

  // Driver ratings por ano
  driver_ratings: {
    out: "driver_ratings.json",
    columns: {
      year: ["year","ano"],
      driver_id: ["driver_id","id"],
      driver_name: ["driver_name","display_name","name"],
      current_ability: ["current_ability","overall","rating","ovr"],
      potential_ability: ["potential_ability","pa"],
      // atributos longos: mantemos pass-through; canónicos acima já chegam
    }
  },

  // Histórico/Carreira
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

  // Staff master
  staff_core: {
    out: "staff_core.json",
    columns: {
      staff_id: ["staff_id","id"],
      staff_name: ["staff_name","name","display_name"],
      country_name: ["country_name","nationality","country"],
      role_id: ["role_id","role","cargo"]
    }
  },

  // Staff ratings
  staff_ratings: {
    out: "staff_ratings.json",
    columns: {
      year: ["year"],
      staff_id: ["staff_id","id"],
      staff_name: ["staff_name","name","display_name"],
      // atributos mantêm pass-through
    }
  },

  // Teams
  teams: {
    out: "teams.json",
    columns: {
      team_id: ["team_id","id","constructor_id"],
      team_name: ["team_name","name","official_name","oficial_name","equipa"],
      team_base: ["team_base","base","hq","headquarters","city","location"]
    },
    post(row) {
      // short_name gerado se não existir
      if (!row.short_name && row.team_name) {
        row.short_name = String(row.team_name).split(" ")[0];
      }
      return row;
    }
  },

  team_brands: { out: "team_brands.json" },
  team_engines: { out: "team_engines.json" },

  // Contratos (genérico)
  contracts: {
    out: "contracts.json",
    columns: {
      year: ["year"],
      team_id: ["team_id"],
      team_name: ["team_name"],
      driver_id: ["driver_id"],
      driver_name: ["driver_name","display_name","name"],
      contract_end: ["contract_end","contract_until","end_date"],
    },
    post(row) {
      if (row.contract_end) row.contract_end_iso = toISO(row.contract_end);
      return row;
    }
  },

  // Pistas base
  core_tracks: {
    out: "core_tracks.json",
    columns: {
      track_id: ["track_id","circuit_id","id"],
      track_name: ["track_name","name","circuit_name"],
      country: ["country","pais","país","location"]
    }
  },

  // Calendário
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
      if (!row.country && row.Country) row.country = row.Country; // normalização simples
      return row;
    }
  },

  // Resultados de corrida
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

  // Motores base
  core_engines: {
    out: "core_engines.json",
    columns: {
      engine_id: ["engine_id","id"],
      engine_name: ["engine_name","name"],
      aspiration: ["aspiration"]
      // restantes métricas mantêm pass-through
    }
  },

  // Sponsors catálogo (com correção de coluna "sposor_name")
  core_sponsors_catalog: {
    out: "core_sponsors_catalog.json",
    columns: {
      sponsor_id: ["sponsor_id","id"],
      sponsor_name: ["sponsor_name","sposor_name","name"],
      industry: ["industry","sector"]
    }
  },

  // Sponsors contratos
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

  // Regras
  rules: {
    out: "rules.json",
    columns: {
      year: ["year"],
      points_system: ["points_system","points"],
      fastest_lap_points: ["fastest_lap_points","fl_points"],
      currency: ["currency","moeda"]
    }
  },

  // Qualifying rules (tem "Year" capitalizado)
  qualifying_rules: {
    out: "qualifying_rules.json",
    columns: {
      year: ["Year","year"],
      sessions: ["Sessions","sessions"],
      length: ["Length","length"],
      rule: ["Rule","rule"]
    }
  },

  // Segurança por era
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

  // Modelo de acidentes
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

  // Atributos base
  core_driver_attributes: { out: "core_driver_attributes.json" },
  core_staff_attributes: { out: "core_staff_attributes.json" },
  core_roles: { out: "core_roles.json" },

  // Séries (limpamos colunas Unnamed/-)
  Series: {
    out: "series.json",
    columns: {
      series_id: ["series_id","id"],
      series_division: ["series_division","division"],
      series_short_name: ["series_short_name","short_name","short"],
      series_name: ["series_name","name","title"]
    }
  },

  // Pesos de atributos de piloto
  driver_attribute_weights: {
    out: "driver_attribute_weights.json",
    columns: {
      attribute: ["attribute","key","attr"],
      // restantes colunas ficam pass-through
    }
  }
};

// ---------- Pipeline ----------
async function processSheet(wb, ws) {
  const name = ws.name;
  const cfg = SHEET_CONFIG[name] || null;

  // 1) headers limpos
  const rawHeaders = readHeader(ws);
  const headers = rawHeaders.map(cleanHeader).map((h, i) => h ?? `col_${i+1}`);
  const dropIdx = rawHeaders.map((h, i) => cleanHeader(h) ? null : i);

  // 2) rows
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (isEmptyRow(row)) continue;
    const obj = rowToObjExpanded(row, headers, cfg);
    // remove chaves col_* que correspondem a Unnamed/- (se ficaram vazias)
    for (const di of dropIdx) {
      if (di != null) delete obj[`col_${di+1}`];
    }
    rows.push(obj);
  }

  const outName = cfg?.out || `${slug(name)}.json`;
  return { outName, rows };
}

async function main() {
  if (!fs.existsSync(SRC_XLSX)) {
    console.error(`[convert-excel] Excel not found at: ${SRC_XLSX}`);
    process.exit(1);
  }

  ensureDir(OUT_DIR);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC_XLSX);

  const sheets = wb.worksheets;
  console.log(`[convert-excel] Sheets detected: ${sheets.map(s => s.name).join(", ")}`);

  for (const ws of sheets) {
    const { outName, rows } = await processSheet(wb, ws);
    const outPath = path.join(OUT_DIR, outName);
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf8");
    console.log(`[convert-excel] Wrote ${outName} (${rows.length} rows)`);
  }

  console.log(`[convert-excel] Done.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
