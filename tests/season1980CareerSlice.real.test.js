// Real-data regression gate for the first playable 1980 Renault Grand Prix.
// This deliberately calls the gameplay weekend/finalization boundaries, not a
// synthetic one-lap race or an independent Results calculator.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";
import {
  createRaceWeekendState,
  completePracticeSession,
  completeQualifyingSession,
  continueRaceWeekendSession,
  completeRaceSession,
  syncRaceWeekendPhaseForDate,
  raceWeekendSchedule,
  shouldCreateWeekendForDate,
} from "../src/engine/RaceWeekendEngine.js";
import { buildRaceWeekendInput } from "../src/race2/adapters/GameStateInputAdapter.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import { createLiveRaceRunner, runFastRace, runFastRaceToEnd } from "../src/race2/core/RaceRunner.js";
import { attachCanonicalRaceRuntime } from "../src/race2/runtime/RaceRuntime.js";
import { prepareGameStateForSave, extractGameStateFromStoredSave } from "../src/core/saveSafety.js";

function roundTripSave(state) {
  // The v2 manual/Continue payload is JSON, with this migration entry on load.
  const serialized = JSON.stringify(prepareGameStateForSave(state));
  return extractGameStateFromStoredSave(JSON.parse(serialized));
}

test("1980 Renault: real Argentina Practice -> Q -> full race -> Results -> points -> save/load -> next GP", {
  timeout: 1_500_000,
}, async () => {
  const pack = JSON.parse(await fs.readFile(
    new URL("../public/data/seasons/1980/season.json", import.meta.url), "utf8"
  ));
  assert.equal(pack.validation?.ok, true, JSON.stringify(pack.validation));
  const state = pack.state;
  assert.deepEqual(state.calendar.map(race => Number(race.laps)),
    [53, 40, 78, 80, 72, 76, 54, 76, 45, 54, 72, 60, 70, 59],
    "the entire 1980 career calendar must have sourced race distances");
  const renault = state.teams.find(t => String(t.team_name).toLowerCase() === "renault");
  assert.ok(renault, "Renault must be playable in the real 1980 Season Pack");
  const gp = state.calendar[0];
  const nextGp = state.calendar[1];
  assert.match(String(gp?.gp_name), /argentin/i);
  assert.ok(nextGp, "the 1980 calendar must continue after Argentina");

  const seats = (state.contracts || []).filter(isRaceDriverContract);
  const garageByTeam = {};
  for (const team of state.teams) {
    const teamId = String(team.team_id);
    garageByTeam[teamId] = {
      cars: seats.filter(seat => String(seat.team_id) === teamId)
        .slice(0, 2)
        .map((seat, i) => ({
          id: teamId === String(renault.team_id) ? `car_${i + 1}` : `${teamId}_race_${i + 1}`,
          kind: "race",
          driver_id: seat.driver_id,
          componentCondition: { engine: 100, suspension: 100 },
        })),
    };
  }
  assert.equal(garageByTeam[String(renault.team_id)].cars.length, 2);

  const initialDate = String(gp.race_date ?? gp.dateISO ?? gp.date).slice(0, 10);
  let gs = {
    ...state,
    activeYear: 1980,
    currentRound: 0,
    currentDateISO: initialDate,
    saveMeta: { schemaVersion: 2, seed: "renault-1980-first-full-race" },
    team: renault,
    driverAttributes: {},
    driverAvailability: {},
    medicalHistory: [],
    temporaryDriverAssignments: [],
    standings: { drivers: [], teams: [] },
    results: [],
    inbox: [],
    financeLog: [],
    finances: { balance: 10_000_000, budget: 10_000_000, season_spend: 0, season_income: 0 },
    settings: { gameplay: { enableInjuryRandomEvents: false, enableFatalities: false } },
    garage: garageByTeam[String(renault.team_id)],
    aiTechnicalWorld: { teams: Object.fromEntries(
      state.teams.filter(t => String(t.team_id) !== String(renault.team_id))
        .map(t => [String(t.team_id), { garage: garageByTeam[String(t.team_id)] }])
    ) },
  };

  gs = createRaceWeekendState(gs, { roundIndex: 0, gp, engineVersion: "rw2" });
  assert.equal(gs.raceWeekendState.phase, "practice");
  assert.ok(gs.raceEntryState.entries.length >= 20);
  gs = completePracticeSession(gs, { gp });
  assert.equal(gs.raceWeekendState.phase, "practice_complete");
  let completedQualifying = 0;
  for (let i = 0; i < 8 && gs.raceWeekendState.phase !== "grid_ready"; i++) {
    gs = { ...gs, currentDateISO: gs.raceWeekendState.raceDate };
    gs = continueRaceWeekendSession(gs);
    if (gs.raceWeekendState.phase === "qualifying") {
      gs = completeQualifyingSession(gs, { gp });
      completedQualifying++;
    }
  }
  assert.equal(completedQualifying, 2, "1980 must use two qualifying sessions");
  assert.equal(gs.raceWeekendState.phase, "grid_ready");
  assert.equal(gs.raceWeekendState.startingGrid.rows.length, 24);

  gs = { ...gs, currentDateISO: gs.raceWeekendState.raceDate };
  gs = continueRaceWeekendSession(gs);
  assert.equal(gs.raceWeekendState.phase, "race");
  const input = buildRaceWeekendInput(gs, { gp });
  assert.equal(input.engineVersion, "rw2");
  assert.equal(input.year, 1980);
  assert.ok(input.track.lengthM > 4000, "do not race on a synthetic short circuit");
  assert.equal(input.track.laps, 53, "Argentina 1980 was 53 full racing laps");
  assert.equal(input.startingGrid.length, 24);
  assert.ok(input.cars.length >= 24, "all starters must have real cars");

  const initialRace = startRaceState(createRaceState(input));
  assert.equal(initialRace.cars.length, 24);
  const partial = runFastRace(initialRace, { steps: 120 });
  const live = createLiveRaceRunner(initialRace);
  for (let i = 0; i < 120; i++) live.step();
  assert.deepEqual(live.getState(), partial, "Live and Autosim diverged before checkpoint");

  const checkpoint = attachCanonicalRaceRuntime(gs, {
    version: 1, state: partial, accumulatorMs: 0,
  });
  const loaded = roundTripSave(checkpoint);
  assert.equal(loaded.raceWeekendState.phase, "race");
  assert.deepEqual(
    loaded.raceWeekendState.canonical_race_runtime.state,
    JSON.parse(JSON.stringify(partial)),
    "Save/Load must preserve the canonical JSON RaceState, not restart the race"
  );

  const finished = runFastRaceToEnd(
    loaded.raceWeekendState.canonical_race_runtime.state, { maxSteps: 150_000 }
  );
  assert.equal(finished.status, "finished");
  assert.ok(finished.cars.some(car => car.completedLaps === input.track.laps));
  gs = attachCanonicalRaceRuntime(loaded, {
    ...loaded.raceWeekendState.canonical_race_runtime,
    state: finished,
    accumulatorMs: 0,
  });

  const finalized = await completeRaceSession(gs, { gp });
  assert.equal(finalized.raceWeekendState.phase, "results");
  assert.equal(finalized.results.length, 1, "first GP must create exactly one archive event");
  const race = finalized.results[0];
  assert.equal(race.engine_version, "rw2");
  assert.equal(race.year, 1980);
  assert.equal(race.round, 1);
  assert.equal(race.classification.length, 24, "including any DNF");
  assert.equal(new Set(race.classification.map(row => String(row.driver_id))).size, 24);
  assert.ok(race.classification.every(row => row.team_id && Number.isFinite(row.position)));
  assert.ok(finalized.standings.drivers.length >= 24);
  assert.ok(finalized.standings.teams.length > 0);

  const repeated = await completeRaceSession(finalized, { gp });
  assert.deepEqual(repeated.results, finalized.results, "reopening Results must not award points twice");
  assert.deepEqual(repeated.standings, finalized.standings);

  let recovered = roundTripSave(finalized);
  assert.deepEqual(recovered.results, JSON.parse(JSON.stringify(finalized.results)),
    "Results must survive Save/Load in the JSON storage representation");
  assert.deepEqual(recovered.standings, JSON.parse(JSON.stringify(finalized.standings)),
    "standings must survive Save/Load in the JSON storage representation");
  assert.equal(recovered.raceWeekendState.phase, "results");
  const followingDay = new Date(Date.parse(recovered.raceWeekendState.raceDate + "T00:00:00Z") + 86_400_000)
    .toISOString().slice(0, 10);
  recovered = syncRaceWeekendPhaseForDate({
    ...recovered, currentDateISO: followingDay,
  }, followingDay);
  assert.equal(recovered.raceWeekendState.phase, "completed");

  const nextStart = raceWeekendSchedule(nextGp, recovered.qualifyingRules).weekendStartDate;
  recovered = {
    ...recovered,
    currentRound: 1,
    currentDateISO: nextStart,
  };
  assert.ok(shouldCreateWeekendForDate(recovered, {
    roundIndex: 1, gp: nextGp, dateISO: nextStart,
  }), "calendar progression must allow the next Grand Prix");
  const nextWeekend = createRaceWeekendState(recovered, {
    roundIndex: 1, gp: nextGp, engineVersion: "rw2",
  });
  assert.equal(nextWeekend.raceWeekendState.phase, "practice");
  assert.equal(nextWeekend.raceWeekendState.roundIndex, 1);
  assert.equal(nextWeekend.results.length, 1, "next GP must not erase Argentina Results");
  console.log("REAL_1980_CAREER_GATE=" + JSON.stringify({
    openingGp: gp.gp_name,
    nextGp: nextGp.gp_name,
    entrants: gs.raceEntryState.entries.length,
    qualifyingSessions: completedQualifying,
    starters: initialRace.cars.length,
    laps: input.track.laps,
    distanceM: input.track.lengthM,
    steps: finished.tick,
    dnf: finished.cars.filter(car => car.dnf || car.status === "dnf").length,
    classified: race.classification.length,
    savedAndRestored: true,
    archived: nextWeekend.results.length,
    nextPhase: nextWeekend.raceWeekendState.phase,
  }));
});
