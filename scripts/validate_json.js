// scripts/validate_json.js
const fs = require('fs');
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });

const schemas = {
  drivers: {
    type: 'array',
    items: {
      type: 'object',
      required: ['driver_id'],  // só exigimos o ID
      properties: {
        driver_id:   { type: 'string' },
        full_name:   { type: 'string' },
        first_name:  { type: 'string' },
        last_name:   { type: 'string' },
        name:        { type: 'string' },
        nationality: { type: 'string' },
        birthdate:   { type: 'string' },
        team_id:     { type: 'string' },
        attributes:  { type: 'object' }
      }
      // sem allOf/anyOf para o nome — aceitamos qualquer variante
    }
  },
  teams: {
    type: 'array',
    items: {
      type: 'object',
      required: ['team_id'],
      properties: {
        team_id:       { type: 'string' },
        name_common:   { type: 'string' },
        name_official: { type: 'string' },
        name:          { type: 'string' },
        short_name:    { type: 'string' },
        country:       { type: 'string' },
        engine_supplier: { type: 'string' }
      }
    }
  }
};

function check(path, key){
  const raw = fs.readFileSync(path, 'utf8');
  const data = JSON.parse(raw);
  const validate = ajv.compile(schemas[key]);
  const ok = validate(data);
  if(!ok){
    console.error(`[FAIL] ${key}:`, validate.errors);
    process.exitCode = 1;
  } else {
    console.log(`[OK] ${key}: ${data.length} records`);
  }
}

try {
  check('data/drivers.json','drivers');
  check('data/teams.json','teams');
} catch (e) {
  console.error('Validator error:', e.message);
  process.exitCode = 1;
}
