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
        driver_id: { type: "string", minLength: 1 },
        display_name: { type: ["string", "null"] },
        name: { type: ["string", "null"] },
        nationality: { type: ["string", "null"] },
        birthdate: { type: ["string", "null"] },
        team_id: { type: ["string", "null"] }
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

try {
  check("public/data/drivers.json", "drivers");
  check("public/data/teams.json", "teams");
  check("public/data/calendar.json", "calendar");
  check("public/data/points_systems.json", "pointsSystems");
} catch (error) {
  console.error("[FAIL] Data validation:", error.message);
  process.exitCode = 1;
}
