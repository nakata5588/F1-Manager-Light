// src/game/season/seasonRollover.js
import { getRulesForYear } from "../utils/rules"; // wrapper para public/data/rules.json
import { createSeasonSkeleton } from "./seasonInit"; // opcional, só para organizar

export async function seasonRollover(state, data, newYear) {
  const lastYear = newYear - 1;

  // 1) Regras do novo ano vindas do rules.json
  const rules = await getRulesForYear(newYear); 
  // Ex.: { numbering_system: "champion_1", teammate_gets_2: true, vacate_1_if_champion_retires: true, ... }

  // 2) Formar plantéis do novo ano a partir de contracts
  const rostersNew = (data.contracts || [])
    .filter(c => c.start_year <= newYear && c.contract_until >= newYear)
    .map(c => ({ year: newYear, team_id: c.team_id, driver_id: c.driver_id, role: c.role }));

  // 3) Criar esqueleto da época (calendário, etc.)
  const season = createSeasonSkeleton(newYear, data, rules);

  // 4) Atribuir números segundo o sistema definido nesse ano
  const driverNumbers = assignDriverNumbers({
    rules,
    year: newYear,
    lastYearChampion: state.history?.standings?.[lastYear]?.drivers?.[0] || null, // {driver_id, team_id}
    rosters: rostersNew,
    numberBlocks: data.numberBlocks?.[newYear] || data.numberBlocks?.default || {} // opcional
  });

  // 5) Devolver novo estado
  return {
    ...state,
    currentSeason: newYear,
    currentRound: 0,
    rulesByYear: { ...(state.rulesByYear || {}), [newYear]: rules },
    rosters: { ...(state.rosters || {}), [newYear]: rostersNew },
    driverNumbers: { ...(state.driverNumbers || {}), [newYear]: driverNumbers },
    history: { ...(state.history || {}), standings: { ...(state.history?.standings || {}), [lastYear]: state.currentStandings || {} } },
  };
}

// --- atribuição de números, genérica
function assignDriverNumbers({ rules, year, lastYearChampion, rosters, numberBlocks }) {
  const numbers = {}; const taken = new Set();

  if (rules.numbering_system === "champion_1" && lastYearChampion?.driver_id) {
    numbers[lastYearChampion.driver_id] = 1; taken.add(1);

    if (rules.teammate_gets_2) {
      const mate = rosters.find(r => r.team_id === lastYearChampion.team_id && r.driver_id !== lastYearChampion.driver_id);
      if (mate) { numbers[mate.driver_id] = 2; taken.add(2); }
    }
  }

  // Atribuir blocos históricos por equipa, se existirem
  for (const r of rosters) {
    if (numbers[r.driver_id]) continue;
    const block = numberBlocks[r.team_id] || [];
    const pick = block.find(n => !taken.has(n));
    if (pick) { numbers[r.driver_id] = pick; taken.add(pick); }
  }

  // Fallback: preencher restantes com o próximo livre
  let cur = 3;
  for (const r of rosters) {
    if (!numbers[r.driver_id]) {
      while (taken.has(cur)) cur++;
      numbers[r.driver_id] = cur; taken.add(cur);
    }
  }
  return numbers;
}
