import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyLegacySavesToIndexedDb,
  openIndexedDbShadowArchive,
  sha256SaveText,
} from "../src/state/indexedDbSaveArchive.js";

const hashText = async text => createHash("sha256").update(text).digest("hex");
function storageFixture() {
  const data = new Map();
  const save = (year, seed = "renault-1980") => ({
    saveMeta: { schemaVersion: 2, gameVersion: "1.0.1", migrations: [], seed },
    activeYear: year, currentRound: 1,
    team: { team_id: "renault" },
    raceWeekendState: {
      phase: "race", canonical_race_runtime: {
        state: { status: "running", tick: 250, rngState: { cursor: 150 } },
      },
    },
    results: [{ gp_id: "1980_argentina", classification: [
      { driver_id: "d_1", position: 1, gap: null },
    ] }],
  });
  const state = save(1980);
  data.set("f1ml_save_1980", JSON.stringify({
    meta: { name: "Renault 1980", savedAt: "2026-10-09T10:00:00Z" },
    gameState: state,
  }));
  data.set("f1hm_save", JSON.stringify(state));
  data.set("f1ml_last_save_key", "f1ml_save_1980");
  return {
    data, save,
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => data.delete(key),
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
  };
}
function memoryArchive() {
  const records = new Map();
  return {
    records,
    async get(id) { return records.get(id) ?? undefined; },
    async add(entry) {
      if (records.has(entry.id)) {
        throw Object.assign(new Error("Already exists"), { name: "ConstraintError" });
      }
      records.set(entry.id, structuredClone(entry));
    },
  };
}

test("verified IndexedDB shadow copy keeps original localStorage saves and exact canonical runtime", async () => {
  const storage = storageFixture();
  const original = new Map(storage.data);
  const archive = memoryArchive();
  const result = await copyLegacySavesToIndexedDb({
    storage, shadowArchive: archive, hashText,
  });
  assert.deepEqual([result.ok, result.copied, result.existing, result.failed],
    [true, 2, 0, 0]);
  assert.deepEqual(storage.data, original, "no legacy slot or pointer may change");
  assert.equal(archive.records.size, 2);
  const manual = [...archive.records.values()].find(entry => entry.kind === "manual");
  assert.equal(manual.raw, storage.getItem("f1ml_save_1980"));
  assert.equal(manual.sha256, await hashText(manual.raw));
  const extracted = JSON.parse(manual.raw).gameState;
  assert.equal(extracted.raceWeekendState.canonical_race_runtime.state.tick, 250);
  assert.equal(extracted.results[0].classification[0].gap, null);
});

test("re-running the same copy is idempotent, overwritten slots create immutable revisions", async () => {
  const storage = storageFixture();
  const archive = memoryArchive();
  const first = await copyLegacySavesToIndexedDb({ storage, shadowArchive: archive, hashText });
  const second = await copyLegacySavesToIndexedDb({ storage, shadowArchive: archive, hashText });
  assert.equal(first.copied, 2);
  assert.deepEqual([second.copied, second.existing, second.failed], [0, 2, 0]);
  const oldRaw = storage.getItem("f1ml_save_1980");
  storage.setItem("f1ml_save_1980", JSON.stringify({
    meta: { name: "Renault 1980", savedAt: "2026-10-10T10:00:00Z" },
    gameState: storage.save(1981),
  }));
  const third = await copyLegacySavesToIndexedDb({ storage, shadowArchive: archive, hashText });
  assert.equal(third.copied, 1);
  assert.equal(third.existing, 1);
  assert.equal(archive.records.size, 3, "prior snapshots must never be overwritten");
  assert.ok([...archive.records.values()].some(entry => entry.raw === oldRaw));
});

test("bad or unsupported slots are reported and left in localStorage", async () => {
  const storage = storageFixture();
  storage.setItem("f1ml_save_broken", "{not valid json");
  storage.setItem("f1ml_save_future", JSON.stringify({
    meta: {}, gameState: { saveMeta: { schemaVersion: 999 }, activeYear: 2030 },
  }));
  const original = new Map(storage.data);
  const archive = memoryArchive();
  const result = await copyLegacySavesToIndexedDb({ storage, shadowArchive: archive, hashText });
  assert.equal(result.ok, false);
  assert.equal(result.failed, 2);
  assert.equal(result.copied, 2);
  assert.deepEqual(storage.data, original);
  assert.match(result.entries.find(entry => entry.key === "f1ml_save_future").error, /newer than supported/);
});

test("failed archive write, silent write and hash corruption never count as success", async () => {
  const storage = storageFixture();
  const throwing = {
    get: async () => null,
    add: async () => { throw Object.assign(new Error("Disk quota"), { name: "QuotaExceededError" }); },
  };
  const failed = await copyLegacySavesToIndexedDb({ storage, shadowArchive: throwing, hashText });
  assert.equal(failed.ok, false);
  assert.equal(failed.copied, 0);
  assert.equal(failed.failed, 2);
  const silent = { get: async () => null, add: async () => {} };
  const notPersisted = await copyLegacySavesToIndexedDb({ storage, shadowArchive: silent, hashText });
  assert.equal(notPersisted.failed, 2);
  const corrupt = { get: async id => ({ id, raw: "bad", sha256: "x" }), add: async () => {} };
  const mismatch = await copyLegacySavesToIndexedDb({ storage, shadowArchive: corrupt, hashText });
  assert.equal(mismatch.failed, 2);
});

test("concurrent source modification is detected, never claiming verified migration", async () => {
  const storage = storageFixture();
  const archive = memoryArchive();
  const original = storage.getItem("f1ml_save_1980");
  let modified = false;
  const changingHash = async raw => {
    if (raw === original && !modified) {
      modified = true;
      storage.setItem("f1ml_save_1980", JSON.stringify({
        meta: { name: "Other revision" }, gameState: storage.save(1981),
      }));
    }
    return hashText(raw);
  };
  const report = await copyLegacySavesToIndexedDb({
    storage, shadowArchive: archive, hashText: changingHash,
  });
  assert.equal(report.ok, false);
  assert.equal(report.entries.find(entry => entry.key === "f1ml_save_1980").status, "failed");
  assert.match(report.entries.find(entry => entry.key === "f1ml_save_1980").error, /source changed/i);
  assert.equal(storage.getItem("f1ml_last_save_key"), "f1ml_save_1980");
});

test("WebCrypto digest matches SHA-256 and unavailable IndexedDB never alters saves", async () => {
  assert.equal(await sha256SaveText("abc"), await hashText("abc"));
  const storage = storageFixture();
  const original = new Map(storage.data);
  await assert.rejects(
    copyLegacySavesToIndexedDb({ storage, indexedDBFactory: null, hashText }),
    /IndexedDB is unavailable/
  );
  assert.deepEqual(storage.data, original);
});

// Exercise actual request/transaction semantics without a real browser:
// add() resolves only after the IDB transaction is committed.
test("native IndexedDB adapter stores and reads immutable revisions, rejects duplicates", async () => {
  const rows = new Map();
  let closed = false;
  const db = {
    objectStoreNames: { contains: name => name === "verifiedLegacySnapshots" },
    createObjectStore() {},
    close() { closed = true; },
    transaction(_store, _mode) {
      const tx = {
        error: null,
        objectStore() {
          return {
            get(id) {
              const request = { result: undefined, error: null };
              queueMicrotask(() => {
                request.result = rows.get(id);
                request.onsuccess?.();
                tx.oncomplete?.();
              });
              return request;
            },
            add(entry) {
              const request = { result: undefined, error: null };
              queueMicrotask(() => {
                if (rows.has(entry.id)) {
                  request.error = Object.assign(new Error("duplicate"), { name: "ConstraintError" });
                  tx.error = request.error;
                  request.onerror?.();
                  tx.onabort?.();
                  return;
                }
                rows.set(entry.id, structuredClone(entry));
                request.result = entry.id;
                request.onsuccess?.();
                tx.oncomplete?.();
              });
              return request;
            },
          };
        },
      };
      return tx;
    },
  };
  const indexedDBFactory = {
    open() {
      const request = { result: db, error: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const archive = await openIndexedDbShadowArchive({ indexedDBFactory });
  assert.equal(await archive.get("id_1"), undefined);
  await archive.add({ id: "id_1", raw: "do not overwrite" });
  assert.deepEqual(await archive.get("id_1"), { id: "id_1", raw: "do not overwrite" });
  await assert.rejects(archive.add({ id: "id_1", raw: "different" }), /duplicate/);
  assert.equal((await archive.get("id_1")).raw, "do not overwrite");
  archive.close();
  assert.equal(closed, true);
});
