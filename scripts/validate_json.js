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
  staffCore: {
    type: "array",
    items: {
      type: "object",
      required: ["staff_id", "staff_name"],
      properties: {
        staff_id: { type: "string", minLength: 1 },
        staff_name: { type: "string", minLength: 1 }
      }
    }
  },
  staffRatings: {
    type: "array",
    items: {
      type: "object",
      required: ["year", "staff_id"],
      properties: {
        year: { type: ["integer", "number"] },
        staff_id: { type: "string", minLength: 1 },
        staff_name: { type: ["string", "null"] },
        reputation: { type: ["integer", "number", "null"] },
        leadership: { type: ["integer", "number", "null"] },
        technical: { type: ["integer", "number", "null"] },
        strategy: { type: ["integer", "number", "null"] },
        motivation: { type: ["integer", "number", "null"] },
        communication: { type: ["integer", "number", "null"] },
        pitstop_management: { type: ["integer", "number", "null"] },
        reliability_focus: { type: ["integer", "number", "null"] },
        data_analysis: { type: ["integer", "number", "null"] },
        innovation: { type: ["integer", "number", "null"] },
        budget_management: { type: ["integer", "number", "null"] },
        driver_development: { type: ["integer", "number", "null"] },
        conflict_management: { type: ["integer", "number", "null"] },
        negotiation: { type: ["integer", "number", "null"] }
      }
    }
  },
  staffContracts: {
    type: "array",
    items: {
      type: "object",
      required: ["year", "team_id", "staff_id", "role"],
      properties: {
        year: { type: ["integer", "number"] },
        team_id: { type: "string", minLength: 1 },
        staff_id: { type: "string", minLength: 1 },
        staff_name: { type: ["string", "null"] },
        role: { type: "string", minLength: 1 },
        contract_start_year: { type: ["integer", "number", "null"] },
        contract_until_year: { type: ["integer", "number", "null"] }
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

const STAFF_RATING_FIELDS = [
  "reputation",
  "leadership",
  "technical",
  "strategy",
  "motivation",
  "communication",
  "pitstop_management",
  "reliability_focus",
  "data_analysis",
  "innovation",
  "budget_management",
  "driver_development",
  "conflict_management",
  "negotiation",
];

function hasStaffRatingSignal(row) {
  return STAFF_RATING_FIELDS.some((key) => {
    const value = row?.[key];
    return value != null && value !== "" && Number.isFinite(Number(value));
  });
}

function checkStaffRatings(path, staffCorePath) {
  const rows = readJson(path);
  const staff = readJson(staffCorePath);
  const validate = ajv.compile(schemas.staffRatings);
  if (!validate(rows)) {
    console.error(`[FAIL] ${path}`);
    console.error(validate.errors);
    process.exitCode = 1;
    return;
  }

  const staffIds = new Set(staff.map((row) => String(row.staff_id || "")));
  const missingStaff = rows.filter((row) => !staffIds.has(String(row.staff_id || "")));
  const blanks = rows.filter((row) => !hasStaffRatingSignal(row));
  const invalidValues = rows.filter((row) =>
    STAFF_RATING_FIELDS.some((key) => {
      const value = row?.[key];
      if (value == null || value === "") return false;
      const n = Number(value);
      return !Number.isFinite(n) || n < 0 || n > 100;
    })
  );
  const seen = new Set();
  const duplicates = [];
  for (const row of rows) {
    const key = `${Number(row.year)}|${String(row.staff_id)}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }

  if (missingStaff.length) {
    console.error(`[FAIL] ${path}: ${missingStaff.length} rows reference missing staff identities`);
    console.error(missingStaff.slice(0, 10));
    process.exitCode = 1;
  }
  if (blanks.length) {
    console.error(`[FAIL] ${path}: ${blanks.length} rows contain no usable Staff rating data`);
    console.error(blanks.slice(0, 10));
    process.exitCode = 1;
  }
  if (invalidValues.length) {
    console.error(`[FAIL] ${path}: ${invalidValues.length} rows contain ratings outside 0..100`);
    console.error(invalidValues.slice(0, 10));
    process.exitCode = 1;
  }
  if (duplicates.length) {
    console.error(`[FAIL] ${path}: duplicate year/staff rows: ${duplicates.slice(0, 10).join(", ")}`);
    process.exitCode = 1;
  }
  if (!missingStaff.length && !blanks.length && !invalidValues.length && !duplicates.length) {
    console.log(`[OK] ${path}: ${rows.length} canonical Staff rating rows`);
  }
}

function checkStaffContracts(path, staffCorePath, teamsPath) {
  const rows = readJson(path);
  const staff = readJson(staffCorePath);
  const teams = readJson(teamsPath);
  const validate = ajv.compile(schemas.staffContracts);
  if (!validate(rows)) {
    console.error(`[FAIL] ${path}`);
    console.error(validate.errors);
    process.exitCode = 1;
    return;
  }

  const staffIds = new Set(staff.map((row) => String(row.staff_id || "")));
  const teamIds = new Set(teams.map((row) => String(row.team_id || "")));
  const missingStaff = rows.filter((row) => !staffIds.has(String(row.staff_id || "")));
  const missingTeams = rows.filter((row) => !teamIds.has(String(row.team_id || "")));
  const invalidPeriods = rows.filter((row) => {
    const startRaw = row.contract_start_year;
    const endRaw = row.contract_until_year;
    if (startRaw == null || startRaw === "" || endRaw == null || endRaw === "") return false;
    const start = Number(startRaw);
    const end = Number(endRaw);
    return Number.isFinite(start) && Number.isFinite(end) && start > end;
  });

  if (missingStaff.length) {
    console.error(`[FAIL] ${path}: ${missingStaff.length} rows reference missing staff identities`);
    console.error(missingStaff.slice(0, 10));
    process.exitCode = 1;
  }
  if (missingTeams.length) {
    console.error(`[FAIL] ${path}: ${missingTeams.length} rows reference missing teams`);
    console.error(missingTeams.slice(0, 10));
    process.exitCode = 1;
  }
  if (invalidPeriods.length) {
    console.error(`[FAIL] ${path}: ${invalidPeriods.length} rows have contract_start_year > contract_until_year`);
    console.error(invalidPeriods.slice(0, 10));
    process.exitCode = 1;
  }
  if (!missingStaff.length && !missingTeams.length && !invalidPeriods.length) {
    console.log(`[OK] ${path}: ${rows.length} staff contracts with canonical IDs`);
  }
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
  check("public/data/staff_core.json", "staffCore");
  checkStaffRatings("public/data/staff_ratings.json", "public/data/staff_core.json");
  checkStaffContracts("public/data/staff_contracts.json", "public/data/staff_core.json", "public/data/teams.json");
  checkOpeningState("public/data/driver_opening_state.json");
} catch (error) {
  console.error("[FAIL] Data validation:", error.message);
  process.exitCode = 1;
}
