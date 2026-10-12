import test from "node:test";
import assert from "node:assert/strict";
import {
  applySessionRecoverySnapshot,
  buildSessionRecoverySnapshot,
  clearSessionRecoverySnapshot,
  sessionRecoveryMatchesState,
  sessionRecoveryIsStale,
} from "../src/domain/sessionRecovery.js";

function savedState(overrides = {}) {
  return {
    saveMeta: { schemaVersion: 2, seed: "renault-career" },
    team: { team_id: "renault" },
    activeYear: 1980,
    currentDateISO: "1980-01-13",
    currentRound: 0,
    raceWeekendState: {
      gp_id: "argentina",
      phase: "race",
      active_session_id: "race",
      canonical_race_runtime: { state: { status: "running", tick: 200 } },
    },
    ...overrides,
  };
}

test("a tab checkpoint from a previous season cannot rewind the same career", () => {
  const newer = savedState({
    activeYear: 1981, currentRound: 0, currentDateISO: "1981-01-15",
  });
  const older = buildSessionRecoverySnapshot(savedState());
  assert.equal(sessionRecoveryIsStale(newer, older), true);
  assert.equal(sessionRecoveryMatchesState(newer, older), false);
  assert.strictEqual(applySessionRecoverySnapshot(newer, older), newer);
});

test("previous round or date checkpoint cannot replace a newer Continue snapshot", () => {
  const nextRound = savedState({
    currentRound: 1, currentDateISO: "1980-01-27",
    raceWeekendState: { gp_id: "brazil", phase: "practice" },
  });
  const lastRound = buildSessionRecoverySnapshot(savedState());
  assert.equal(sessionRecoveryMatchesState(nextRound, lastRound), false);
  const laterDate = savedState({ currentDateISO: "1980-01-14" });
  assert.equal(sessionRecoveryMatchesState(laterDate, lastRound), false);
  assert.strictEqual(applySessionRecoverySnapshot(laterDate, lastRound), laterDate);
});

test("same-round journal with another GP cannot replace saved race", () => {
  const rolling = savedState({ raceWeekendState: {
    gp_id: "brazil", phase: "race", active_session_id: "race",
    canonical_race_runtime: { state: { status: "running", tick: 200 } },
  } });
  const journal = buildSessionRecoverySnapshot(savedState());
  assert.equal(sessionRecoveryMatchesState(rolling, journal), false);
});

test("finished race cannot be reopened by a running checkpoint", () => {
  const official = savedState({
    raceWeekendState: {
      gp_id: "argentina", phase: "results",
      canonical_race_runtime: { state: { status: "finished", tick: 800 } },
    },
  });
  const stale = buildSessionRecoverySnapshot(savedState());
  assert.equal(sessionRecoveryMatchesState(official, stale), false);
  assert.strictEqual(applySessionRecoverySnapshot(official, stale), official);
});

test("within the same race, old canonical ticks are rejected but newer checkpoints recover", () => {
  const saved = savedState();
  const behind = buildSessionRecoverySnapshot(savedState({
    raceWeekendState: {
      ...saved.raceWeekendState,
      canonical_race_runtime: { state: { status: "running", tick: 199 } },
    },
  }));
  const ahead = buildSessionRecoverySnapshot(savedState({
    raceWeekendState: {
      ...saved.raceWeekendState,
      canonical_race_runtime: { state: { status: "running", tick: 201 } },
    },
  }));
  assert.equal(sessionRecoveryMatchesState(saved, behind), false);
  assert.equal(sessionRecoveryMatchesState(saved, ahead), true);
  assert.equal(applySessionRecoverySnapshot(saved, ahead).raceWeekendState.canonical_race_runtime.state.tick, 201);
});

test("newer valid journal can still recover a stale qualifying Continue snapshot", () => {
  const rolling = savedState({
    currentDateISO: "1980-01-12",
    raceWeekendState: { gp_id: "argentina", phase: "qualifying", live_race: null },
  });
  const journal = buildSessionRecoverySnapshot(savedState());
  assert.equal(sessionRecoveryMatchesState(rolling, journal), true);
  assert.equal(applySessionRecoverySnapshot(rolling, journal).raceWeekendState.phase, "race");
});

test("explicit load invalidates the old tab checkpoint, without affecting saved slots", () => {
  const data = new Map([
    ["f1ml_session_recovery", JSON.stringify(buildSessionRecoverySnapshot(savedState()))],
    ["f1ml_save_1", JSON.stringify({ meta: { name: "Renault 1980" }, gameState: savedState() })],
  ]);
  const store = {
    getItem: key => data.get(key) ?? null,
    removeItem: key => data.delete(key),
  };
  assert.equal(clearSessionRecoverySnapshot(store), true);
  assert.equal(store.getItem("f1ml_session_recovery"), null);
  assert.ok(store.getItem("f1ml_save_1"), "explicit loads must never delete a save slot");
  assert.equal(clearSessionRecoverySnapshot({
    removeItem: () => { throw new Error("Storage blocked"); },
  }), false);
});
