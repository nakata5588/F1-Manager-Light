import test from "node:test";
import assert from "node:assert/strict";
import { createManualSaveWriter } from "../src/state/manualSavePersistence.js";
import { createLegacyCareerRepository, LEGACY_SAVE_KEYS } from "../src/state/careerSaveRepository.js";

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => data.delete(key),
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
  };
}

test("legacy repository delegates manual Save As and retains identical envelope/pointers", () => {
  const storage = memoryStorage();
  const writer = createManualSaveWriter({
    now: () => 1_728_000_000_000,
    newSlotSuffix: () => "repo-test",
  });
  const repository = createLegacyCareerRepository({ storage, manualWriter: writer });
  const state = {
    saveMeta: { schemaVersion: 2, seed: "career-a" },
    activeYear: 1980, currentRound: 0,
    raceWeekendState: {
      phase: "race", canonical_race_runtime: { state: { tick: 250, status: "running" } },
    },
    results: [{ gp_id: "1980_1", position: 3, elapsed_ms: 900001 }],
  };
  const meta = { name: "Renault 1980", seed: "career-a", savedAt: "2026-10-09T10:00:00Z" };
  const result = repository.saveManual({ gameState: state, meta });
  assert.equal(result.ok, true);
  assert.equal(result.lastSavePointerOk, true);
  assert.equal(result.continueSnapshotOk, true);
  assert.equal(repository.readSlot(result.key), JSON.stringify({ meta, gameState: state }));
  assert.equal(repository.readContinue(), JSON.stringify(state));
  assert.equal(repository.getLastManualSaveKey(), result.key);
  assert.equal(repository.latestManualSaveKey(), result.key);
  assert.equal(repository.hasAnySave(), true);
  assert.deepEqual(repository.migrationCandidates(), [
    { key: result.key, raw: JSON.stringify({ meta, gameState: state }), kind: "manual" },
    { key: LEGACY_SAVE_KEYS.continue, raw: JSON.stringify(state), kind: "continue" },
  ]);
});

test("legacy repository preserves custom/old slot IDs and unreadable slots", () => {
  const storage = memoryStorage();
  storage.setItem("legacy-custom-slot", JSON.stringify({ gameState: { activeYear: 1975 } }));
  storage.setItem("f1ml_save_broken", "not JSON");
  const repository = createLegacyCareerRepository({ storage });
  assert.match(repository.readSlot("legacy-custom-slot"), /1975/);
  assert.equal(repository.hasAnySave(), true);
  assert.equal(repository.listManualSlots()[0].key, "f1ml_save_broken");
  assert.equal(repository.readSlot("missing"), null);
  assert.equal(storage.getItem("f1ml_save_broken"), "not JSON");
});

test("listing newest saves follows existing savedAt and timestamp fallback", () => {
  const storage = memoryStorage();
  storage.setItem("f1ml_save_1000000000001", JSON.stringify({
    meta: { savedAt: "2026-10-08T12:00:00Z" }, gameState: { activeYear: 1980 },
  }));
  storage.setItem("f1ml_save_1000000000002", JSON.stringify({
    meta: { savedAt: "2026-10-09T12:00:00Z" }, gameState: { activeYear: 1981 },
  }));
  const repository = createLegacyCareerRepository({ storage });
  assert.equal(repository.latestManualSaveKey(), "f1ml_save_1000000000002");
  assert.equal(repository.listManualSlots().length, 2);
});

test("manual writer is mandatory for writes, and errors do not evict original data", () => {
  const storage = memoryStorage();
  const repository = createLegacyCareerRepository({ storage });
  assert.throws(() => repository.saveManual({ gameState: {}, meta: {} }), /writer/);
  assert.deepEqual([...storage.data.keys()], []);
  assert.throws(() => createLegacyCareerRepository(), /Web Storage/);
});
