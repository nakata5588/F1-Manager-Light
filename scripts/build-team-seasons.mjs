import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "public", "data", "race_results.json");
const target = path.join(root, "public", "data", "team_seasons.json");

async function isFresh() {
  try {
    const [src, out] = await Promise.all([fs.stat(source), fs.stat(target)]);
    return out.mtimeMs >= src.mtimeMs;
  } catch {
    return false;
  }
}

if (await isFresh()) {
  console.log("team_seasons.json is up to date");
  process.exit(0);
}

const rows = JSON.parse(await fs.readFile(source, "utf8"));
const unwrap = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v.result ?? v.value ?? null;
  }
  return v;
};

const byKey = new Map();
for (const row of Array.isArray(rows) ? rows : []) {
  const year = Number(unwrap(row?.year ?? row?.season_year));
  const teamId = String(unwrap(row?.team_id ?? row?.constructor_id) ?? "");
  const teamName = String(unwrap(row?.team_name ?? row?.constructor_name) ?? "");
  const driverId = String(unwrap(row?.driver_id ?? row?.person_id) ?? "");
  if (!Number.isFinite(year) || !teamId) continue;
  const key = `${year}|${teamId}`;
  if (!byKey.has(key)) {
    byKey.set(key, { year, team_id: teamId, team_name: teamName, driver_ids: new Set() });
  }
  const rec=byKey.get(key);
  if(driverId) rec.driver_ids.add(driverId);
}

const output = [...byKey.values()]
  .map((row)=>({
    year:row.year,
    team_id:row.team_id,
    team_name:row.team_name,
    driver_count:row.driver_ids.size,
    driver_ids:[...row.driver_ids].sort(),
  }))
  .sort((a, b) => a.year - b.year || a.team_name.localeCompare(b.team_name));
await fs.writeFile(target, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(`Generated team_seasons.json: ${output.length} team-season rows`);
