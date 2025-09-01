// scripts/convert-excel.mjs
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const ROOT = process.cwd();
const SRC_XLSX = process.env.DB_XLSX || path.join(ROOT, "data", "f1_db.xlsx");
const OUT_DIR = path.join(ROOT, "public", "data");

const MAP = [
  { sheet: "drivers", out: "drivers.json", required: ["id","name","short_name","nationality","birthdate","team","current_ability","contract_until"] },
  { sheet: "calendar", out: "calendar.json", required: ["id","name","dateISO"] },
  { sheet: "teams", out: "teams.json", required: ["id","name","short_name"] }
];

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function readSheet(wb, name){
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function validateRows(rows, required){
  if (!rows) return [];
  // Aviso rápido se faltar alguma coluna obrigatória:
  const missing = required.filter(k => !Object.keys(rows[0] ?? {}).includes(k));
  if (missing.length) {
    console.warn(`[convert-excel] Sheet is missing columns: ${missing.join(", ")}`);
  }
  return rows;
}

function toISO(dateLike){
  // Aceita já ISO "YYYY-MM-DD" ou datas Excel; tenta converter robustamente
  if (!dateLike) return null;
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
  // se vier como número (serial Excel)
  if (typeof dateLike === "number") {
    const dt = XLSX.SSF.parse_date_code(dateLike);
    if (dt) {
      const d = new Date(Date.UTC(dt.y, (dt.m ?? 1) - 1, dt.d ?? 1));
      return d.toISOString().slice(0,10);
    }
  }
  // última tentativa: Date.parse
  const t = Date.parse(dateLike);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0,10);
  return null;
}

function postProcess(sheetName, rows){
  if (sheetName === "calendar") {
    return rows.map(r => ({ ...r, dateISO: toISO(r.dateISO) ?? r.dateISO }));
  }
  if (sheetName === "drivers") {
    return rows.map(r => ({
      ...r,
      birthdate: toISO(r.birthdate) ?? r.birthdate,
      contract_until: toISO(r.contract_until) ?? r.contract_until
    }));
  }
  return rows;
}

function main(){
  if (!fs.existsSync(SRC_XLSX)) {
    console.error(`[convert-excel] Excel not found at: ${SRC_XLSX}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(SRC_XLSX, { cellDates: true });

  ensureDir(OUT_DIR);

  for (const { sheet, out, required } of MAP) {
    const rows = readSheet(wb, sheet);
    const validated = validateRows(rows, required);
    const processed = postProcess(sheet, validated);
    const outPath = path.join(OUT_DIR, out);
    fs.writeFileSync(outPath, JSON.stringify(processed, null, 2), "utf8");
    console.log(`[convert-excel] Wrote ${out} (${processed.length} rows)`);
  }
}

main();
