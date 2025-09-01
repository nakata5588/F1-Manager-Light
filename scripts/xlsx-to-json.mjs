// scripts/xlsx-to-json.mjs
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

/**
 * CONFIG
 * Ajusta se precisares.
 */
const INPUT_XLSX = path.resolve("data/f1_db.xlsx");
const OUT_DIR = path.resolve("public/data");

// sheets do Excel -> nome do ficheiro JSON a escrever
const SHEETS_TO_EXPORT = {
  drivers: "drivers.json",
  calendar: "calendar.json",
  teams: "teams.json",
  driver_ratings: "driver_ratings.json",
  staff_ratings: "staff_ratings.json",
  team_brands: "team_brands.json",
  team_engines: "team_engines.json",
  contracts: "contracts.json",
  sponsors_contracts: "sponsors_contracts.json",
  rules: "rules.json",
  era_safety: "era_safety.json",
  accident_model: "accident_model.json",
  // adicionar mais se precisares: race_results, core_tracks, etc.
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function valueToJS(v) {
  // ExcelJS já devolve JS types; convertemos datas para 'YYYY-MM-DD' simples
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return v;
}

function normalizeHeader(h) {
  if (h == null) return "";
  return String(h).trim();
}

async function sheetToObjects(wb, sheetName) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return null;

  // 1) headers na primeira linha (index 1 em exceljs)
  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = normalizeHeader(cell.value);
  });

  // se a primeira linha estiver vazia, tentamos encontrar a primeira com headers
  let startRow = 2;
  const nonEmptyHeaders = headers.filter(Boolean);
  if (nonEmptyHeaders.length === 0) {
    // procura a primeira linha com algum valor
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const any = row.values.some((v) => v && String(v).trim() !== "");
      if (any) {
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          headers[col] = normalizeHeader(cell.value);
        });
        startRow = r + 1;
        break;
      }
    }
  }

  // 2) linhas de dados
  const rows = [];
  for (let r = startRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row || row.number === 1) continue;
    const obj = {};
    let empty = true;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col] || `col_${col}`;
      const val = valueToJS(cell.value);
      if (val !== null && val !== "" && val !== undefined) empty = false;
      obj[key] = val;
    });
    if (!empty) rows.push(obj);
  }
  return rows;
}

async function main() {
  if (!fs.existsSync(INPUT_XLSX)) {
    console.error("✘ Excel não encontrado em:", INPUT_XLSX);
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(INPUT_XLSX);

  ensureDir(OUT_DIR);

  let exportedAny = false;
  for (const [sheet, outFile] of Object.entries(SHEETS_TO_EXPORT)) {
    const data = await sheetToObjects(wb, sheet);
    if (!data) {
      console.warn(`⚠ sheet "${sheet}" não existe no Excel — a ignorar.`);
      continue;
    }
    fs.writeFileSync(path.join(OUT_DIR, outFile), JSON.stringify(data, null, 2), "utf8");
    console.log(`✔ wrote ${outFile} (${data.length} rows)`);
    exportedAny = true;
  }

  if (!exportedAny) {
    console.error("✘ Nenhum sheet exportado. Confirma os nomes dos tabs no Excel.");
    process.exit(2);
  }

  console.log("\nDone. Agora o jogo vai ler de /public/data/*.json ✅");
}

main().catch((e) => {
  console.error("✘ Extract falhou:", e);
  process.exit(2);
});
