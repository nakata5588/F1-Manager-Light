// scripts/validate_json.js
import fs from "node:fs";
import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });

const schemas = {
  drivers: {
    type: "array",
    items: {
      type: "object",
      required: ["driver_id"],
      properties: {
        // Legacy exports can still contain Excel-rich values in descriptive fields.
        // The runtime normalizes those; the validator guarantees stable identity.
        driver_id: { type: "string", minLength: 1 }
      }
    }
  },
  teams: {
    type: "array",
    items: {
      type: "object",
      required: ["team_id"],
      properties: {
        team_id: { type: "string", minLength: 1 },
        team_name: { type: ["string", "null"] },
        name: { type: ["string", "null"] },
        short_name: { type: ["string", "null"] }
      }
    }
  },
  calendar: {
    type: "array",
    items: {
      type: "object",
      required: ["year"],
      properties: {
        year: { type: ["integer", "number", "string"] },
        round: { type: ["integer", "number", "string", "null"] },
        gp_name: { type: ["string", "null"] },
        dateISO: { type: ["string", "null"] }
      }
    }
  },
  pointsSystems: {
    type: "array",
    items: {
      type: "object",
      required: ["year_from", "places_csv"],
      properties: {
        year_from: { type: ["integer", "number"] },
        year_to: { type: ["integer", "number", "null"] },
        places_csv: { type: ["string", "array"] }
      }
    }
  },
  driverOpeningState: {
    type: "array",
    items: {
      type: "object",
      required: [
        "year",
        "opening_date",
        "driver_id",
        "opening_world_status",
        "opening_availability",
        "runtime_visibility",
        "runtime_market_policy"
      ],
      properties: {
        year: { type: ["integer", "number", "string"] },
        opening_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        driver_id: { type: "string", minLength: 1 },
        opening_world_status: { type: "string", minLength: 1 },
        opening_availability: { type: "string", minLength: 1 },
        opening_team_id: { type: ["string", "null"] },
        opening_role: { type: ["string", "null"] },
        series_context: { type: ["string", "null"] },
        runtime_visibility: { type: "string", minLength: 1 },
        runtime_market_policy: { type: "string", minLength: 1 },
        confidence: { type: ["string", "null"] }
      }
    }
  }
};

function readJson(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing required file: ${path}`);
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function check(path, key) {
  const data = readJson(path);
  const validate = ajv.compile(schemas[key]);
  if (!validate(data)) {
    console.error(`[FAIL] ${path}`);
    console.error(validate.errors);
    process.exitCode = 1;
    return;
  }
  console.log(`[OK] ${path}: ${Array.isArray(data) ? data.length : "valid"} records`);
}

function checkOpeningState(path) {
  if (!fs.existsSync(path)) {
    console.log(`[SKIP] ${path}: optional until a canonical workbook exposes driver_opening_state`);
    return;
  }
  const data = readJson(path);
  const validate = ajv.compile(schemas.driverOpeningState);
  if (!validate(data)) {
    console.error(`[FAIL] ${path}`);
    console.error(validate.errors);
    process.exitCode = 1;
    return;
  }

  const seen = new Set();
  const duplicates = [];
  for (const row of data) {
    const key = `${Number(row.year)}|${String(row.driver_id)}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  if (duplicates.length) {
    console.error(`[FAIL] ${path}: duplicate year/driver rows: ${duplicates.slice(0, 10).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[OK] ${path}: ${data.length} opening-state records`);
}

try {
  check("public/data/drivers.json", "drivers");
  check("public/data/teams.json", "teams");
  check("public/data/calendar.json", "calendar");
  check("public/data/points_systems.json", "pointsSystems");
  checkOpeningState("public/data/driver_opening_state.json");
} catch (error) {
  console.error("[FAIL] Data validation:", error.message);
  process.exitCode = 1;
}
