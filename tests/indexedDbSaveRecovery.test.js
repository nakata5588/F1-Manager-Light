import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyLegacySavesToIndexedDb,
  openIndexedDbShadowArchive,
} from "../src/state/indexedDbSaveArchive.js";
import {
  listIndexedDbSaveRevisions,
  restoreIndexedDbSaveAsNewSlot,
  verifyIndexedDbSaveRevision,
} from "../src/state/indexedDbSaveRecovery.js";
import { extractGameStateFromStoredSave } from "../src/core/saveSafety.js";

const hashText = async raw => createHash("sha256").update(raw).digest("hex");
const stamp = () => new Date("2026-10-09T18:00:00.000Z");

function state(year = 1980) {
  return {
    saveMeta: { schemaVersion: 2, gameVersion: "1.0.1", seed: "renault-career", migrations: [] },
    activeYear: year, currentRound: 0, currentDateISO: "1980-01-13",
    team: { team_id: "renault" }, finances: { balance: 1_200_000 },
    raceWeekendState: {
      phase: "race", canonical_race_runtime: {
        state: { status: "running", tick: 2211, cars: [
          { driver_id: "d_1", tyreWear: 0.1729, distanceAlongLap: 1002.34 },
        ], rngState: { cursor: 2211 } },
      },
    },
    results: [{ event: "argentina", classification: [
      { driver_id: "d_1", position: 4, gap: null },
    ] }],
  };
}

function store(entries = []) {
  const values = new Map(entries);
  let failing = null;
  let noOp = null;
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (failing?.(key)) throw new Error("QuotaExceededError: storage full");
      if (!noOp?.(key)) values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
    get length() { return values.size; },
    key: i => [...values.keys()][i] ?? null,
    failWhen: predicate => { failing = predicate; },
    ignoreWritesWhen: predicate => { noOp = predicate; },
  };
}

function memoryArchive(rows = new Map()) {
  return {
    rows,
    async get(id) { return rows.get(id) ?? undefined; },
    async list() { return [...rows.values()].map(row => structuredClone(row)); },
    async add(row) {
      if (rows.has(row.id)) {
        throw Object.assign(new Error("Constraint"), { name: "ConstraintError" });
      }
      rows.set(row.id, structuredClone(row));
    },
  };
}
function oldSlots() {
  const manual = JSON.stringify({
    meta: { name: "Renault 1980", savedAt: "2026-10-09T12:00:00Z" },
    gameState: state(),
  });
  const continueRaw = JSON.stringify(state());
  return store([
    ["f1ml_save_1980", manual],
    ["f1hm_save", continueRaw],
    ["f1ml_last_save_key", "f1ml_save_1980"],
  ]);
}
async function archived() {
  const storage = oldSlots();
  const archive = memoryArchive();
  const copied = await copyLegacySavesToIndexedDb({
    storage, shadowArchive: archive, hashText,
  });
  assert.equal(copied.ok, true);
  return { storage, archive, rows: archive.rows };
}

test("explicit opt-in copies, lists, then restores after browser close to a NEW manual slot", async () => {
  const { storage: before, rows } = await archived();
  const original = new Map(before.values);
  // Simulate browser/tab closure: no in-memory GameStore and no live IDB handle.
  const afterRestart = oldSlots();
  afterRestart.values.clear(); // e.g. Continue and manual slots were lost
  const reopened = memoryArchive(rows); // IndexedDB revisions persisted
  const listed = await listIndexedDbSaveRevisions({ archive: reopened, hashText });
  assert.equal(listed.length, 2);
  assert.ok(listed.every(x => x.verified));
  assert.ok(listed.some(x => x.year === 1980 && x.phase === "race"));
  const manual = listed.find(x => x.kind === "manual");
  const restored = await restoreIndexedDbSaveAsNewSlot({
    id: manual.id, archive: reopened, storage: afterRestart,
    hashText, now: stamp, newSlotSuffix: () => "browser_reopened",
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.key, "f1ml_save_recovered_browser_reopened");
  assert.equal(afterRestart.getItem("f1hm_save"), null,
    "recovery does not automatically activate an older career");
  assert.equal(afterRestart.getItem("f1ml_last_save_key"), null);
  const recoveredEnvelope = JSON.parse(afterRestart.getItem(restored.key));
  assert.match(recoveredEnvelope.meta.name, /Recovered.*Renault 1980/);
  assert.equal(recoveredEnvelope.meta.savedAt, "2026-10-09T18:00:00.000Z");
  assert.deepEqual(recoveredEnvelope.gameState, state(),
    "never recalculate canon race tick, tyres, finances, or official Results");
  const loaded = extractGameStateFromStoredSave(recoveredEnvelope);
  assert.equal(loaded.raceWeekendState.canonical_race_runtime.state.tick, 2211);
  assert.equal(loaded.results[0].classification[0].gap, null);
  assert.deepEqual(before.values, original, "the initial local saves are untouched");
});

test("Continue archive is recoverable as ordinary manual Save, not automatically Continued", async () => {
  const { storage, archive } = await archived();
  const original = new Map(storage.values);
  const [backup] = (await listIndexedDbSaveRevisions({ archive, hashText }))
    .filter(x => x.kind === "continue");
  const result = await restoreIndexedDbSaveAsNewSlot({
    id: backup.id, storage, archive, hashText, now: stamp,
    newSlotSuffix: () => "continue_copy",
  });
  const restored = JSON.parse(storage.getItem(result.key));
  assert.match(restored.meta.name, /Recovered.*Continue/);
  assert.deepEqual(restored.gameState, state());
  for (const [key, raw] of original) {
    assert.equal(storage.getItem(key), raw, key + " must not be rewritten");
  }
  assert.equal(storage.values.size, original.size + 1);
});

test("restoration is idempotent in data, never overwrites a slot or previous revision", async () => {
  const { storage, archive } = await archived();
  const [manual] = (await listIndexedDbSaveRevisions({ archive, hashText }))
    .filter(x => x.kind === "manual");
  let n = 0;
  const factory = () => "recovery_" + ++n;
  const one = await restoreIndexedDbSaveAsNewSlot({
    id: manual.id, storage, archive, hashText, newSlotSuffix: factory, now: stamp,
  });
  const frozen = storage.getItem(one.key);
  const two = await restoreIndexedDbSaveAsNewSlot({
    id: manual.id, storage, archive, hashText, newSlotSuffix: factory, now: stamp,
  });
  assert.notEqual(one.key, two.key);
  assert.equal(storage.getItem(one.key), frozen);
  assert.equal(storage.getItem("f1ml_last_save_key"), "f1ml_save_1980");
  assert.equal(storage.getItem("f1hm_save"), JSON.stringify(state()));
});

test("concurrent tabs choose independent slots; collisions skip existing user data", async () => {
  const { storage, archive } = await archived();
  const [manual] = (await listIndexedDbSaveRevisions({ archive, hashText }))
    .filter(x => x.kind === "manual");
  storage.setItem("f1ml_save_recovered_collision", "user data");
  let firstCalls = 0;
  const a = restoreIndexedDbSaveAsNewSlot({
    id: manual.id, storage, archive, hashText, now: stamp,
    newSlotSuffix: () => ++firstCalls === 1 ? "collision" : "tab_a",
  });
  const b = restoreIndexedDbSaveAsNewSlot({
    id: manual.id, storage, archive, hashText, now: stamp,
    newSlotSuffix: () => "tab_b",
  });
  const [left, right] = await Promise.all([a, b]);
  assert.notEqual(left.key, right.key);
  assert.equal(storage.getItem("f1ml_save_recovered_collision"), "user data");
  assert.ok(storage.getItem(left.key) && storage.getItem(right.key));
});

test("corruption, unsupported schema and missing snapshots cannot create any save", async () => {
  const { storage, archive } = await archived();
  const original = new Map(storage.values);
  const [manual] = (await listIndexedDbSaveRevisions({ archive, hashText }))
    .filter(x => x.kind === "manual");
  const originalArchive = archive.rows.get(manual.id);
  archive.rows.set(manual.id, { ...originalArchive, raw: originalArchive.raw.replace("Renault", "Ferrari") });
  await assert.rejects(
    restoreIndexedDbSaveAsNewSlot({ id: manual.id, storage, archive, hashText }),
    /checksum does not match/i
  );
  const damaged = await listIndexedDbSaveRevisions({ archive, hashText });
  assert.equal(damaged.find(x => x.id === manual.id).verified, false);
  archive.rows.set(manual.id, originalArchive);
  await assert.rejects(
    restoreIndexedDbSaveAsNewSlot({ id: "unknown", storage, archive, hashText }),
    /not found/i
  );
  const badRaw = JSON.stringify({
    meta: {}, gameState: { saveMeta: { schemaVersion: 3000 }, activeYear: 2050 },
  });
  const hash = await hashText(badRaw);
  const bad = {
    id: "f1ml_save_future:" + hash, legacyKey: "f1ml_save_future",
    kind: "manual", length: badRaw.length, raw: badRaw, sha256: hash,
  };
  await assert.rejects(verifyIndexedDbSaveRevision(bad, hashText), /newer than supported/i);
  assert.deepEqual(storage.values, original);
});

test("quota failure or silent write never destroys old slots or reports recovered", async () => {
  const { storage, archive } = await archived();
  const [manual] = (await listIndexedDbSaveRevisions({ archive, hashText }))
    .filter(x => x.kind === "manual");
  const original = new Map(storage.values);
  storage.failWhen(key => key.startsWith("f1ml_save_recovered_"));
  await assert.rejects(
    restoreIndexedDbSaveAsNewSlot({
      id: manual.id, storage, archive, hashText, newSlotSuffix: () => "quota",
    }), /QuotaExceededError/
  );
  assert.deepEqual(storage.values, original);
  storage.failWhen(() => false);
  storage.ignoreWritesWhen(key => key.startsWith("f1ml_save_recovered_"));
  await assert.rejects(
    restoreIndexedDbSaveAsNewSlot({
      id: manual.id, storage, archive, hashText, newSlotSuffix: () => "silent",
    }), /could not be confirmed/
  );
  assert.deepEqual(storage.values, original);
});

test("native IndexedDB getAll and transaction completion persist between reopened adapters", async () => {
  const rows = new Map();
  let closes = 0;
  const fakeDatabase = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    close: () => { closes++; },
    transaction(_name, mode) {
      const tx = {
        error: null,
        objectStore: () => ({
          add(value) { return request(() => {
            if (rows.has(value.id)) throw Object.assign(new Error("Duplicate"), { name: "ConstraintError" });
            rows.set(value.id, structuredClone(value));
            return value.id;
          }); },
          get(id) { return request(() => structuredClone(rows.get(id))); },
          getAll() { return request(() => [...rows.values()].map(x => structuredClone(x))); },
        }),
      };
      function request(callback) {
        const req = { result: undefined, error: null };
        queueMicrotask(() => {
          try { req.result = callback(); req.onsuccess?.(); tx.oncomplete?.(); }
          catch (error) { req.error = error; tx.error = error; req.onerror?.(); tx.onabort?.(); }
        });
        return req;
      }
      return tx;
    },
  };
  const factory = {
    open() {
      const req = { result: fakeDatabase, error: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  const first = await openIndexedDbShadowArchive({ indexedDBFactory: factory });
  await first.add({ id: "backup-1", raw: "data" });
  assert.equal((await first.list()).length, 1);
  first.close();
  const reopened = await openIndexedDbShadowArchive({ indexedDBFactory: factory });
  assert.equal((await reopened.list())[0].raw, "data");
  assert.equal((await reopened.get("backup-1")).raw, "data");
  reopened.close();
  assert.equal(closes, 2);
});


test("Settings archive panel renders opt-in actions without doing background migration", async () => {
  const { createServer } = await import("vite");
  const React = await import("react");
  const { MemoryRouter } = await import("react-router-dom");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const { default: Panel } = await server.ssrLoadModule(
      "/src/components/saves/SaveBackupRecoveryPanel.jsx"
    );
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(Panel))
    );
    assert.match(html, /Save Backups &amp; Recovery/);
    assert.match(html, /Copy &amp; verify local saves/);
    assert.match(html, /View archived revisions/);
    assert.match(html, /never created automatically/);
    assert.doesNotMatch(html, /Restore to new slot/,
      "no restore action without the user requesting an archive listing");
  } finally {
    await server.close();
  }
});
