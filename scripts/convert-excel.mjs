// scripts/convert-excel.mjs
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const ROOT = process.cwd();
const SRC_XLSX = process.env.DB_XLSX || path.join(ROOT, "data", "f1_db.xlsx");
const OUT_DIR = path.join(ROOT, "public", "data");

// ---- Configuração dos alvos (folhas + mapeamento de colunas) ----
const TARGETS = [
  {
  key: "drivers",
  out: "drivers.json",
  sheetAliases: ["drivers","pilotos","driver","roster","drivers_1980","drivers80"],
  columns: {
    // id
    id: ["id","driver_id","codigo","cod"],

    // nome — aceita várias formas
    name: ["name","driver","nome","piloto","full_name","fullname"],
    first_name: ["first_name","firstname","given_name","given","nome_proprio","nome1"],
    last_name: ["last_name","lastname","family_name","surname","apelido","sobrenome"],

    // equipa
    team: ["team","equipa","constructor","escuderia","team_name","constructor_name","equipa_nome","constructorid","teamid"],

    // nacionalidade / país
    nationality: ["nationality","nat","pais","país","country","nation"],

    // datas
    birthdate: ["birthdate","dob","data_nasc","nascimento","data_nascimento"],

    // overall / rating
    current_ability: ["current_ability","overall","ovr","rating","habilidade","habilidade_atual","ca"],

    // contrato
    contract_until: ["contract_until","contract","contract_end","fim_contrato","contrato_ate","validade","contractuntil"]
  },
  post(row) {
    // construir name se vier separado
    let name = row.name;
    if (!name && (row.first_name || row.last_name)) {
      name = [row.first_name, row.last_name].filter(Boolean).join(" ");
    }
    return {
      ...row,
      name,
      birthdate: toISO(row.birthdate) ?? row.birthdate ?? null,
      contract_until: toISO(row.contract_until) ?? row.contract_until ?? null
    };
  }
},
  {
    key: "calendar",
  out: "calendar.json",
  sheetAliases: ["calendar", "calendario", "schedule", "races", "gps", "season_calendar", "calendar_1980"],
  // mapeamento de cabeçalhos da tua folha
  columns: {
    id: ["id", "race_id", "gp_id", "round_id"],         // aceita gp_id como id
    name: ["name", "gp", "race", "nome", "grande_premio", "grand_prix", "gp_name", "gpname"],
    country: ["country", "pais", "país", "location", "circuit_country"],
    dateISO: ["dateiso", "date", "data", "race_date"],
    year: ["year", "season"],
    round: ["round", "rd"],
    track_id: ["track_id", "circuit_id", "track"]       // opcional
  },
  post(row) {
    // normalizar datas e garantir tipos simpáticos
    const out = {
      ...row,
      dateISO: toISO(row.dateISO) ?? row.dateISO ?? null
    };
    if (out.year != null) out.year = Number(out.year);
    if (out.round != null) out.round = Number(out.round);
    return out;;
    }
  },
  {
    key: "teams",
    out: "teams.json",
    sheetAliases: ["teams", "equipas", "constructors", "escuderias", "teams_1980"],
    columns: {
      id: ["id", "team_id", "constructor_id", "codigo"],
      name: ["name", "team", "constructor", "nome", "equipa", "official_name", "oficial_name"],
      short_name: ["short_name", "short", "abreviado", "sigla"]
    }
  }
];

// ---- Helpers ----
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function readHeader(ws) {
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    headers.push(String(cell?.value ?? "").trim());
  });
  return headers;
}

function mapHeaders(headers, colSynonyms) {
  const pairs = [];
  const normed = headers.map(norm);
  const keys = Object.keys(colSynonyms);
  for (let i = 0; i < normed.length; i++) {
    const h = normed[i];
    let matched = null;
    for (const key of keys) {
      const syns = colSynonyms[key].map(norm);
      if (syns.includes(h)) { matched = key; break; }
    }
    if (matched) pairs.push({ idx: i + 1, key: matched });
  }
  return pairs;
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
    // Excel serial date (base 1899-12-30)
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

function rowToObj(row, headerMap) {
  const obj = {};
  for (const { idx, key } of headerMap) {
    let v = row.getCell(idx)?.value;
    if (v && typeof v === "object" && "text" in v) v = v.text;
    obj[key] = v instanceof Date ? toISO(v) : v;
  }
  return obj;
}

function scoreHeader(headers, colSynonyms) {
  const set = new Set(headers.map(norm));
  let score = 0;
  for (const key of Object.keys(colSynonyms)) {
    const syns = colSynonyms[key].map(norm);
    if (syns.some((s) => set.has(s))) score++;
  }
  return score;
}

async function extractTarget(wb, target, envVarName) {
  // 1) escolher folha (ENV override -> alias -> heurística)
  const all = wb.worksheets.map((w) => w.name);
  let ws = null;

  const forced = process.env[envVarName];
  if (forced) {
    ws = wb.getWorksheet(forced);
    if (!ws) console.warn(`[convert-excel] Sheet "${forced}" (from ${envVarName}) not found.`);
  }
  if (!ws) {
    const byAlias = all.find((n) => target.sheetAliases.map(norm).includes(norm(n)));
    if (byAlias) ws = wb.getWorksheet(byAlias);
  }
  if (!ws) {
    let best = null;
    let bestScore = -1;
    for (const name of all) {
      const tmp = wb.getWorksheet(name);
      const header = readHeader(tmp);
      const score = scoreHeader(header, target.columns);
      if (score > bestScore) { bestScore = score; best = tmp; }
    }
    if (bestScore > 0) ws = best;
  }

  if (!ws) {
    console.warn(`[convert-excel] Sheet for "${target.key}" not found — writing empty ${target.out}. Candidates: ${all.join(", ")}`);
    return [];
  }

  // 2) mapear cabeçalhos
  const headers = readHeader(ws);
  const headerMap = mapHeaders(headers, target.columns);
  if (headerMap.length === 0) {
    console.warn(`[convert-excel] Sheet "${ws.name}" for "${target.key}" has no recognizable columns.\n  Headers: ${headers.join(" | ")}`);
  }

  // 3) varrer linhas
  const out = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (isEmptyRow(row)) continue;
    const obj = rowToObj(row, headerMap);
    out.push(target.post ? target.post(obj) : obj);
  }
  return out;
}

async function main() {
  if (!fs.existsSync(SRC_XLSX)) {
    console.error(`[convert-excel] Excel not found at: ${SRC_XLSX}`);
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC_XLSX);

  ensureDir(OUT_DIR);

  const envNames = {
    drivers: "DB_SHEET_DRIVERS",
    calendar: "DB_SHEET_CALENDAR",
    teams: "DB_SHEET_TEAMS"
  };

  for (const target of TARGETS) {
    const rows = await extractTarget(wb, target, envNames[target.key]);
    const outPath = path.join(OUT_DIR, target.out);
    fs.writeFileSync(outPath, JSON.stringify(rows ?? [], null, 2), "utf8");
    console.log(`[convert-excel] Wrote ${target.out} (${rows?.length ?? 0} rows)`);
  }

  console.log(`[convert-excel] Sheets detected: ${wb.worksheets.map((w) => w.name).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
