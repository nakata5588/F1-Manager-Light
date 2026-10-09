import test from "node:test";
import assert from "node:assert/strict";
import { createManualSaveWriter } from "../src/state/manualSavePersistence.js";

function fakeStorage() {
  const data = new Map();
  let failure = null;
  let noop = null;
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      if (failure?.(key, value)) throw failure.error || Object.assign(new Error("Storage denied"), { name: "SecurityError" });
      if (!noop?.(key, value)) data.set(key, String(value));
    },
    removeItem(key) { data.delete(key); },
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    failWhen(predicate, error = Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" })) {
      failure = Object.assign(predicate, { error });
    },
    stopFailing() { failure = null; },
    ignoreWritesWhen(predicate) { noop = predicate; },
  };
}

function harness() {
  const storage = fakeStorage();
  let tick = 1_728_000_000_000;
  let sequence = 0;
  const write = createManualSaveWriter({
    now: () => tick,
    newSlotSuffix: () => `test-${++sequence}`,
  });
  const meta = { name: "Renault 1980", savedAt: "2026-10-09T12:00:00Z", seed: "career-a" };
  const gameState = (balance = 12_000_000, seed = "career-a") => ({
    activeYear: 1980,
    currentDateISO: "1980-01-13",
    currentRound: 0,
    team: { team_id: "renault" },
    finances: { balance },
    saveMeta: { seed },
  });
  const save = ({ state = gameState(), name = meta.name, overwriteKey = null } = {}) =>
    write({ storage, gameState: state, meta: { ...meta, name, seed: state.saveMeta.seed }, overwriteKey });
  return { storage, write, meta, gameState, save, advance: (ms = 1201) => { tick += ms; } };
}

test("changed balance with same name, date and round is saved and loaded, not deduplicated", () => {
  const h = harness();
  const first = h.save();
  assert.equal(first.ok, true);
  const second = h.save({ state: h.gameState(11_999_877) });
  assert.equal(second.ok, true);
  assert.notEqual(second.key, first.key);
  assert.equal(JSON.parse(h.storage.getItem(first.key)).gameState.finances.balance, 12_000_000);
  assert.equal(JSON.parse(h.storage.getItem(second.key)).gameState.finances.balance, 11_999_877);
  assert.equal(JSON.parse(h.storage.getItem("f1hm_save")).finances.balance, 11_999_877);
  assert.equal(h.storage.getItem("f1ml_last_save_key"), second.key);
});

test("two identical clicks return the existing, verifiably stored slot", () => {
  const h = harness();
  const first = h.save();
  const second = h.save();
  assert.equal(second.key, first.key);
  assert.equal([...h.storage.data.keys()].filter(k => k.startsWith("f1ml_save_")).length, 1);
  h.advance();
  const third = h.save();
  assert.equal(third.ok, true);
  assert.notEqual(third.key, first.key);
});

test("save identity includes the career and explicit destination slot", () => {
  const h = harness();
  const careerA = h.save({ state: h.gameState(1000, "career-a") });
  const careerB = h.save({ state: h.gameState(1000, "career-b") });
  assert.notEqual(careerA.key, careerB.key);
  const slot1 = h.save({ state: h.gameState(1000), overwriteKey: "f1ml_save_slot1" });
  const slot2 = h.save({ state: h.gameState(1000), overwriteKey: "f1ml_save_slot2" });
  assert.equal(slot1.key, "f1ml_save_slot1");
  assert.equal(slot2.key, "f1ml_save_slot2");
  assert.equal(JSON.parse(h.storage.getItem(careerB.key)).gameState.saveMeta.seed, "career-b");
});

test("same-slot overwrite persists new content, and reload retains race runtime", () => {
  const h = harness();
  const state = {
    ...h.gameState(),
    raceWeekendState: {
      phase: "race",
      canonical_race_runtime: { tick: 1442, lap: 21, seed: 100, cars: [{ driver_id: "d_1", distance: 72.4 }] },
    },
  };
  const initial = h.save({ state });
  const changed = { ...state, finances: { balance: 11_999_877 }, raceWeekendState: {
    ...state.raceWeekendState,
    canonical_race_runtime: { ...state.raceWeekendState.canonical_race_runtime, tick: 1443 },
  } };
  const overwritten = h.save({ state: changed, overwriteKey: initial.key });
  assert.equal(overwritten.ok, true);
  assert.equal(overwritten.key, initial.key);
  assert.deepEqual(JSON.parse(h.storage.getItem(initial.key)).gameState, changed);
  assert.deepEqual(JSON.parse(h.storage.getItem("f1hm_save")), changed);
});

test("quota failure never removes existing manual saves or last known good Continue", () => {
  const h = harness();
  for (let i = 0; i < 5; i++) h.storage.setItem(`f1ml_save_old${i}`, `existing-${i}`);
  h.storage.setItem("f1hm_save", "previous continue");
  h.storage.setItem("f1ml_last_save_key", "f1ml_save_old4");
  h.storage.failWhen(key => key.startsWith("f1ml_save_") && !key.includes("old"));
  const before = new Map(h.storage.data);
  const result = h.save();
  assert.equal(result.ok, false);
  assert.match(result.error, /storage is full/i);
  assert.deepEqual(h.storage.data, before);
});

test("failed overwrite leaves the previous saved career untouched", () => {
  const h = harness();
  const first = h.save();
  const previous = h.storage.getItem(first.key);
  h.storage.failWhen(key => key === first.key);
  const next = h.save({ state: h.gameState(987_654), overwriteKey: first.key });
  assert.equal(next.ok, false);
  assert.equal(h.storage.getItem(first.key), previous);
  assert.equal(JSON.parse(h.storage.getItem("f1hm_save")).finances.balance, 12_000_000);
});

test("failed writes are retryable immediately and are never cached as successes", () => {
  const h = harness();
  h.storage.failWhen(key => key.startsWith("f1ml_save_"));
  const first = h.save();
  assert.equal(first.ok, false);
  h.storage.stopFailing();
  const retried = h.save();
  assert.equal(retried.ok, true);
  assert.ok(h.storage.getItem(retried.key));
});

test("non-quota storage exception is reported and existing saves remain untouched", () => {
  const h = harness();
  const existing = h.save();
  const before = new Map(h.storage.data);
  h.storage.failWhen(key => key.startsWith("f1ml_save_"),
    Object.assign(new Error("Permission denied"), { name: "SecurityError" }));
  const failure = h.save({ state: h.gameState(444) });
  assert.equal(failure.ok, false);
  assert.match(failure.error, /Permission denied/);
  assert.deepEqual(h.storage.data, before);
  assert.ok(h.storage.getItem(existing.key));
});

test("success confirms a persisted manual slot even when Continue cannot update", () => {
  const h = harness();
  h.storage.setItem("f1hm_save", "old continue");
  h.storage.failWhen(key => key === "f1hm_save");
  const saved = h.save();
  assert.equal(saved.ok, true);
  assert.equal(saved.continueSnapshotOk, false);
  assert.equal(saved.lastSavePointerOk, true);
  assert.equal(h.storage.getItem("f1hm_save"), "old continue");
  assert.deepEqual(JSON.parse(h.storage.getItem(saved.key)).gameState, h.gameState());
});

test("a setItem that silently does not write cannot claim success", () => {
  const h = harness();
  h.storage.ignoreWritesWhen(key => key.startsWith("f1ml_save_"));
  const result = h.save();
  assert.equal(result.ok, false);
  assert.match(result.error, /did not confirm/i);
  assert.equal(h.storage.data.size, 0);
});

test("a deleted or externally modified slot cannot be used for duplicate success", () => {
  const h = harness();
  const first = h.save();
  h.storage.removeItem(first.key);
  const second = h.save();
  assert.notEqual(second.key, first.key);
  h.storage.setItem(second.key, "not JSON");
  const third = h.save();
  assert.notEqual(third.key, second.key);
});

test("stale overwrite keys cannot cross career identities", () => {
  const h = harness();
  const slot = h.save({ state: h.gameState(500, "career-a") });
  const previous = h.storage.getItem(slot.key);
  const attempted = h.save({ state: h.gameState(900, "career-b"), overwriteKey: slot.key });
  assert.equal(attempted.ok, false);
  assert.match(attempted.error, /another career/i);
  assert.equal(h.storage.getItem(slot.key), previous);
});

test("legacy saves without seed can still be overwritten safely", () => {
  const h = harness();
  h.storage.setItem("f1ml_save_legacy", JSON.stringify({ meta: { name: "Old" }, gameState: { activeYear: 1980 } }));
  const updated = h.save({ overwriteKey: "f1ml_save_legacy" });
  assert.equal(updated.ok, true);
  assert.equal(JSON.parse(h.storage.getItem(updated.key)).gameState.saveMeta.seed, "career-a");
});

test("unreadable existing slots are preserved instead of overwritten", () => {
  const h = harness();
  h.storage.setItem("f1ml_save_broken", "not JSON");
  const failure = h.save({ overwriteKey: "f1ml_save_broken" });
  assert.equal(failure.ok, false);
  assert.equal(h.storage.getItem("f1ml_save_broken"), "not JSON");
});

test("last-played pointer failure is reported without invalidating a valid manual save", () => {
  const h = harness();
  h.storage.setItem("f1ml_last_save_key", "old slot");
  h.storage.failWhen(key => key === "f1ml_last_save_key");
  const saved = h.save();
  assert.equal(saved.ok, true);
  assert.equal(saved.lastSavePointerOk, false);
  assert.equal(saved.continueSnapshotOk, true);
  assert.equal(h.storage.getItem("f1ml_last_save_key"), "old slot");
  assert.ok(h.storage.getItem(saved.key));
});
