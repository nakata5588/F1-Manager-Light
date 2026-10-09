import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createDurableCareerRepository,
  openDurableCareerDatabase,
  durableRecoveryKey,
  DURABLE_RECOVERY_PREFIX,
} from "../src/state/durableCareerRepository.js";
import { buildSessionRecoverySnapshot } from "../src/domain/sessionRecovery.js";

const hashText = async text => createHash("sha256").update(text).digest("hex");
const FIXED_TIME = "2026-10-09T17:30:00.000Z";

// Minimal native-IDB request and transaction model. All writes use a copy-on-
// write transaction state and commit only after every queued request succeeds.
// A request error or explicit abort rolls back the whole transaction.
function memoryIndexedDb() {
  const databases = new Map();
  let failWrites = false;
  let closedCount = 0;
  const factory = {
    get closedCount() { return closedCount; },
    setFailWrites: value => { failWrites = Boolean(value); },
    peek: (db, store, key) => databases.get(db)?.stores.get(store)?.items.get(key),
    tamper(db, store, key, modify) {
      const row = databases.get(db)?.stores.get(store)?.items.get(key);
      if (row) databases.get(db).stores.get(store).items.set(key, modify(structuredClone(row)));
    },
    open(name, version) {
      const req = { result: null, error: null };
      queueMicrotask(() => {
        let data = databases.get(name);
        const newDb = !data;
        if (!data) {
          data = { stores: new Map(), version };
          databases.set(name, data);
        }
        const db = {
          objectStoreNames: {
            contains: store => data.stores.has(store),
          },
          createObjectStore(store, { keyPath }) {
            if (data.stores.has(store)) throw new Error("Already exists");
            const record = { keyPath, items: new Map() };
            data.stores.set(store, record);
            return record;
          },
          close() { closedCount++; },
          transaction(storeNames, mode) {
            const names = typeof storeNames === "string" ? [storeNames] : storeNames;
            const working = new Map(names.map(n => {
              const src = data.stores.get(n);
              if (!src) throw new Error("Missing object store: " + n);
              return [n, new Map([...src.items].map(([k, v]) => [k, structuredClone(v)]))];
            }));
            let pending = 0;
            let aborted = false;
            let done = false;
            const tx = {
              error: null,
              abort() {
                if (aborted || done) return;
                aborted = true;
                queueMicrotask(() => tx.onabort?.());
              },
              objectStore(storeName) {
                const source = data.stores.get(storeName);
                if (!working.has(storeName)) throw new Error("Undeclared store");
                const rows = working.get(storeName);
                function request(operation) {
                  const req = { result: undefined, error: null };
                  pending++;
                  queueMicrotask(() => {
                    if (aborted || done) return;
                    try {
                      req.result = operation();
                      req.onsuccess?.();
                    } catch (cause) {
                      req.error = cause;
                      tx.error = cause;
                      req.onerror?.();
                      tx.abort();
                      return;
                    } finally {
                      pending--;
                    }
                    queueMicrotask(() => {
                      if (pending !== 0 || aborted || done) return;
                      done = true;
                      if (mode === "readwrite") {
                        for (const [n, values] of working) data.stores.get(n).items = values;
                      }
                      tx.oncomplete?.();
                    });
                  });
                  return req;
                }
                return {
                  get: key => request(() => structuredClone(rows.get(key))),
                  getAll: () => request(() => [...rows.values()].map(v => structuredClone(v))),
                  getAllKeys: () => request(() => [...rows.keys()]),
                  add: row => request(() => {
                    if (failWrites) throw Object.assign(new Error("Quota reached"), { name: "QuotaExceededError" });
                    const key = row[source.keyPath];
                    if (rows.has(key)) throw Object.assign(new Error("Duplicate"), { name: "ConstraintError" });
                    rows.set(key, structuredClone(row));
                    return key;
                  }),
                  put: row => request(() => {
                    if (failWrites) throw Object.assign(new Error("Quota reached"), { name: "QuotaExceededError" });
                    const key = row[source.keyPath];
                    rows.set(key, structuredClone(row));
                    return key;
                  }),
                };
              },
            };
            return tx;
          },
        };
        req.result = db;
        if (newDb) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return factory;
}

function career(year = 1980, seed = "renault-1980") {
  return {
    saveMeta: { schemaVersion: 2, gameVersion: "1.0.1", migrations: [], seed },
    activeYear: year, currentRound: 0, currentDateISO: "1980-01-13",
    team: { team_id: "t_renault" },
    finances: { budget: 1_200_000 },
    raceWeekendState: {
      gp_id: "argentina", phase: "race", active_session_id: "race",
      canonical_race_runtime: {
        state: { tick: 2119, status: "running",
          cars: [{ driver_id: "d_1", distanceAlongLap: 1420.625, tyreWear: .123456 }],
          rngState: { seed: 42, cursor: 889 },
        },
      },
    },
    results: [{
      gp_id: "argentina", classification: [{ driver_id: "d_1", position: 4, gap: null }],
    }],
  };
}

function browserStorage() {
  const data = new Map();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
  };
}

function legacyWithTwoSlots() {
  const storage = browserStorage();
  const st = career();
  storage.setItem("f1ml_save_renault", JSON.stringify({
    meta: { name: "Renault 1980", savedAt: FIXED_TIME }, gameState: st,
  }));
  storage.setItem("f1hm_save", JSON.stringify(st));
  storage.setItem("f1ml_last_save_key", "f1ml_save_renault");
  return storage;
}

async function opened(options = {}) {
  const indexedDBFactory = options.factory || memoryIndexedDb();
  const db = await openDurableCareerDatabase({ indexedDBFactory });
  const repo = createDurableCareerRepository({
    database: db, hashText, now: () => FIXED_TIME,
  });
  return { repo, db, indexedDBFactory };
}

test("one durable save commits revision and head atomically and preserves exact race/Results", async () => {
  const { repo, db } = await opened();
  const raw = JSON.stringify(career());
  const saved = await repo.commit({
    key: "f1hm_save", kind: "continue", raw, expectedRevision: null,
  });
  assert.equal(saved.revision, 1);
  assert.equal(saved.raw, raw);
  assert.equal(saved.sha256, await hashText(raw));
  const current = await repo.readCurrent("f1hm_save");
  assert.deepEqual(current, saved);
  const reread = JSON.parse(current.raw);
  assert.equal(reread.raceWeekendState.canonical_race_runtime.state.tick, 2119);
  assert.equal(reread.results[0].classification[0].gap, null);
  assert.equal(reread.raceWeekendState.canonical_race_runtime.state.rngState.cursor, 889);
  assert.equal((await db.listHeads()).length, 1);
  repo.close();
});

test("overwrites require expected revision: stale tab rejects instead of losing newer state", async () => {
  const { repo, db } = await opened();
  const raw = JSON.stringify(career());
  const first = await repo.commit({
    key: "f1hm_save", kind: "continue", raw, expectedRevision: null,
  });
  await assert.rejects(repo.commit({
    key: "f1hm_save", kind: "continue", raw, expectedRevision: null,
  }), e => e.code === "REVISION_CONFLICT");
  const modified = JSON.stringify({
    ...career(), currentRound: 1, currentDateISO: "1980-01-27",
  });
  const second = await repo.commit({
    key: "f1hm_save", kind: "continue", raw: modified, expectedRevision: 1,
  });
  assert.equal(second.revision, 2);
  assert.equal((await repo.readCurrent("f1hm_save")).raw, modified);
  await assert.rejects(repo.commit({
    key: "f1hm_save", kind: "continue", raw, expectedRevision: 1,
  }), e => e.code === "REVISION_CONFLICT");
  assert.equal((await db.getRevision(first.id)).raw, raw,
    "previous immutable revision must remain accessible after overwrite");
  repo.close();
});

test("an existing manual slot cannot be overwritten by another career; Continue needs explicit authorization", async () => {
  const { repo } = await opened();
  await repo.commit({
    key: "f1ml_save_one", kind: "manual", expectedRevision: null,
    raw: JSON.stringify({ meta: { name: "Renault" }, gameState: career() }),
  });
  await assert.rejects(repo.commit({
    key: "f1ml_save_one", kind: "manual", expectedRevision: 1,
    raw: JSON.stringify({ meta: { name: "Other" }, gameState: career(1980, "other") }),
  }), e => e.code === "CAREER_CONFLICT");
  await assert.rejects(repo.commit({
    key: "f1ml_save_one", kind: "manual", expectedRevision: 1,
    raw: JSON.stringify({ meta: { name: "Other" }, gameState: career(1980, "other") }),
    allowCareerSwitch: true,
  }), e => e.code === "CAREER_CONFLICT");
  await repo.commit({
    key: "f1hm_save", kind: "continue", expectedRevision: null,
    raw: JSON.stringify(career()),
  });
  await assert.rejects(repo.commit({
    key: "f1hm_save", kind: "continue", expectedRevision: 1,
    raw: JSON.stringify(career(1981, "other")),
  }), e => e.code === "CAREER_CONFLICT");
  const replaced = await repo.commit({
    key: "f1hm_save", kind: "continue", expectedRevision: 1,
    raw: JSON.stringify(career(1981, "other")), allowCareerSwitch: true,
  });
  assert.equal(replaced.careerId, "other");
  repo.close();
});

test("interrupted or quota-aborted transaction leaves prior pointer/revision intact", async () => {
  const indexedDBFactory = memoryIndexedDb();
  const { repo, db } = await opened({ factory: indexedDBFactory });
  const before = await repo.commit({
    key: "f1hm_save", kind: "continue", raw: JSON.stringify(career()),
    expectedRevision: null,
  });
  indexedDBFactory.setFailWrites(true);
  await assert.rejects(repo.commit({
    key: "f1hm_save", kind: "continue", raw: JSON.stringify({ ...career(), currentRound: 1 }),
    expectedRevision: 1,
  }), /Quota reached/);
  indexedDBFactory.setFailWrites(false);
  assert.deepEqual(await repo.readCurrent("f1hm_save"), before);
  assert.equal((await db.listHeads()).length, 1);
  repo.close();
});

test("a durable running race checkpoint recovers after tab/browser close without rewinding a newer race", async () => {
  const factory = memoryIndexedDb();
  const first = await opened({ factory });
  const base = career();
  const journal = buildSessionRecoverySnapshot({
    ...base,
    raceWeekendState: { ...base.raceWeekendState,
      canonical_race_runtime: {
        state: { ...base.raceWeekendState.canonical_race_runtime.state, tick: 2300 },
      },
    },
  });
  const saved = await first.repo.writeCheckpoint({
    careerId: "renault-1980", journal, expectedRevision: null,
  });
  assert.equal(saved.key, DURABLE_RECOVERY_PREFIX + "renault-1980");
  assert.equal(saved.revision, 1);
  first.repo.close();
  // A newly opened connection sees the transaction committed in the old tab.
  const second = await opened({ factory });
  const recovered = await second.repo.recoverCheckpoint(base);
  assert.equal(recovered.raceWeekendState.canonical_race_runtime.state.tick, 2300);
  const later = {
    ...base, currentDateISO: "1980-01-27", currentRound: 1,
    raceWeekendState: { gp_id: "brazil", phase: "practice" },
  };
  assert.strictEqual(await second.repo.recoverCheckpoint(later), later);
  await assert.rejects(second.repo.writeCheckpoint({
    careerId: "other-career", journal, expectedRevision: null,
  }), e => e.code === "CAREER_CONFLICT");
  assert.equal(durableRecoveryKey("renault-1980"), saved.key);
  second.repo.close();
});

test("legacy v2 staging is atomic, verified and never changes localStorage or activates IndexedDB", async () => {
  const factory = memoryIndexedDb();
  const { repo } = await opened({ factory });
  const legacy = legacyWithTwoSlots();
  const before = new Map(legacy.data);
  const result = await repo.stageLegacy(legacy);
  assert.deepEqual(result, { state: "staged", count: 2, verified: true });
  assert.deepEqual(legacy.data, before);
  const stage = await repo.readStage();
  assert.equal(stage.state, "staged");
  assert.equal(stage.slots, 2);
  assert.equal((await repo.listHeads()).length, 2);
  assert.equal((await repo.readCurrent("f1ml_save_renault")).raw,
    before.get("f1ml_save_renault"));
  assert.equal((await repo.readCurrent("f1hm_save")).raw, before.get("f1hm_save"));
  await assert.rejects(repo.stageLegacy(legacy), e => e.code === "STAGE_EXISTS");
  assert.equal(await repo.rollbackStage(), true);
  assert.equal((await repo.readStage()).state, "rolled_back");
  assert.deepEqual(legacy.data, before);
  assert.equal((await repo.listHeads()).length, 2, "rollback never deletes revision history");
  repo.close();
});

test("failed staging is all-or-nothing: unsupported saves and quota do not promote any head", async () => {
  const factory = memoryIndexedDb();
  const { repo } = await opened({ factory });
  const legacy = legacyWithTwoSlots();
  const old = new Map(legacy.data);
  legacy.setItem("f1ml_save_future", JSON.stringify({
    meta: {}, gameState: { ...career(), saveMeta: { schemaVersion: 999, seed: "future" } },
  }));
  await assert.rejects(repo.stageLegacy(legacy),
    e => e.code === "UNSUPPORTED_SCHEMA");
  assert.deepEqual(await repo.listHeads(), []);
  assert.equal(await repo.readStage(), null);
  legacy.removeItem("f1ml_save_future");
  factory.setFailWrites(true);
  await assert.rejects(repo.stageLegacy(legacy), /Quota reached/);
  assert.deepEqual(await repo.listHeads(), []);
  assert.equal(await repo.readStage(), null);
  factory.setFailWrites(false);
  assert.deepEqual(new Map([...legacy.data].filter(([k]) => k !== "f1ml_save_future")), old);
  repo.close();
});

test("no seed, wrong checkpoint kind, unsupported future schema and invalid expected revisions fail closed", async () => {
  const { repo } = await opened();
  const noSeed = { ...career(), saveMeta: { schemaVersion: 2 } };
  await assert.rejects(repo.commit({
    key: "f1hm_save", kind: "continue", raw: JSON.stringify(noSeed),
    expectedRevision: null,
  }), e => e.code === "MISSING_CAREER_ID");
  await assert.rejects(repo.commit({
    key: "f1hm_save", kind: "continue", raw: JSON.stringify(career()),
  }), e => e.code === "EXPECTED_REVISION");
  await assert.rejects(repo.commit({
    key: "f1hm_save", kind: "continue", raw: JSON.stringify({
      ...career(), saveMeta: { ...career().saveMeta, schemaVersion: 9000 },
    }), expectedRevision: null,
  }), e => e.code === "UNSUPPORTED_SCHEMA");
  await assert.rejects(repo.commit({
    key: "f1hm_save", kind: "recovery", raw: JSON.stringify({ save_seed: "renault-1980" }),
    expectedRevision: null,
  }), e => e.code === "INVALID_SAVE");
  assert.equal((await repo.listHeads()).length, 0);
  repo.close();
});

test("damaged durable pointer or revision is detected; never silently replaces official data", async () => {
  const factory = memoryIndexedDb();
  const { repo } = await opened({ factory });
  const saved = await repo.commit({
    key: "f1hm_save", kind: "continue", raw: JSON.stringify(career()),
    expectedRevision: null,
  });
  factory.tamper("f1ml-careers", "careerRevisions", saved.id,
    row => ({ ...row, raw: row.raw.replace("renault", "ferrari") }));
  await assert.rejects(repo.readCurrent("f1hm_save"),
    e => e.code === "BAD_CHECKSUM");
  repo.close();
});
