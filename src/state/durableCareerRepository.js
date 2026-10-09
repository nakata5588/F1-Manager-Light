// Versioned, transactionally consistent IndexedDB career storage.
// This is the future asynchronous *authority*, NOT automatically selected by
// the running game. Existing localStorage saves remain authoritative until all
// GameStore and UI entrypoints are migrated and a separate cutover is verified.
import { extractGameStateFromStoredSave, SAVE_SCHEMA_VERSION } from "../core/saveSafety.js";
import { createLegacyCareerRepository, LEGACY_SAVE_KEYS } from "./careerSaveRepository.js";
import { sha256SaveText } from "./indexedDbSaveArchive.js";
import { applySessionRecoverySnapshot, sessionRecoveryMatchesState } from "../domain/sessionRecovery.js";

export const DURABLE_DB_NAME = "f1ml-careers";
export const DURABLE_DB_VERSION = 1;
export const DURABLE_REVISIONS_STORE = "careerRevisions";
export const DURABLE_HEADS_STORE = "careerHeads";
export const DURABLE_META_STORE = "careerMeta";
export const DURABLE_STAGE_KEY = "cutover";
export const DURABLE_RECOVERY_PREFIX = "recovery:";

function isRecord(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function error(code, message) {
  const result = new Error(message);
  result.code = code;
  return result;
}

function asJson(raw) {
  if (typeof raw !== "string" || !raw.length) {
    throw error("INVALID_SAVE", "The save must contain non-empty JSON bytes.");
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw error("INVALID_SAVE", "The save JSON cannot be parsed."); }
  if (!isRecord(parsed)) throw error("INVALID_SAVE", "The save must be an object.");
  return parsed;
}

function compatibleSave(key, kind, raw) {
  const parsed = asJson(raw);
  let careerId;
  let schemaVersion;
  if (kind === "recovery") {
    if (!key.startsWith(DURABLE_RECOVERY_PREFIX) || !isRecord(parsed.raceWeekendState)) {
      throw error("INVALID_SAVE", "A recovery checkpoint must contain a Race Weekend.");
    }
    careerId = String(parsed.save_seed || "");
    schemaVersion = Number(parsed.version ?? 1);
    if (!careerId || key !== DURABLE_RECOVERY_PREFIX + encodeURIComponent(careerId)) {
      throw error("INVALID_SAVE", "A recovery checkpoint belongs to another career.");
    }
    if (schemaVersion !== 1) {
      throw error("UNSUPPORTED_SCHEMA", "Unsupported recovery checkpoint version.");
    }
  } else {
    if (kind === "manual") {
      if (!key.startsWith(LEGACY_SAVE_KEYS.manualPrefix) || !isRecord(parsed.gameState)) {
        throw error("INVALID_SAVE", "Manual slots require the legacy gameState envelope.");
      }
    } else if (kind === "continue") {
      if (key !== LEGACY_SAVE_KEYS.continue || isRecord(parsed.gameState)) {
        throw error("INVALID_SAVE", "Continue must be the legacy flat gameState.");
      }
    } else {
      throw error("INVALID_SAVE", "Unsupported durable save kind.");
    }
    const original = kind === "manual" ? parsed.gameState : parsed;
    const rawSchema = Number(original?.saveMeta?.schemaVersion ?? 0);
    if (!Number.isInteger(rawSchema) || rawSchema < 0 || rawSchema > SAVE_SCHEMA_VERSION) {
      throw error("UNSUPPORTED_SCHEMA", "Save schema is not supported by this game.");
    }
    // Validate through the authoritative loader, not another engine.
    extractGameStateFromStoredSave(parsed);
    careerId = String(original?.saveMeta?.seed || parsed?.meta?.seed || "");
    schemaVersion = rawSchema;
  }
  if (!careerId) {
    throw error("MISSING_CAREER_ID",
      "This save has no stable career seed. Export it and upgrade via the legacy loader first.");
  }
  return { careerId, schemaVersion };
}

function transactionError(tx, request, fallback) {
  return tx?.error || request?.error || error("IDB_TRANSACTION", fallback);
}

// No async/await within an active IndexedDB transaction: native browsers can
// otherwise auto-commit between awaits. All writes occur in request callbacks.
// Resolves only after *transaction.oncomplete*, not request.onsuccess.
function transaction(db, stores, mode, schedule) {
  return new Promise((resolve, reject) => {
    let tx;
    let finished = false;
    let outcome;
    let rejectedReason = null;
    try { tx = db.transaction(stores, mode); }
    catch (cause) { reject(cause); return; }
    const rejectOnce = (cause) => {
      if (finished) return;
      finished = true;
      reject(cause);
    };
    const abort = (cause) => {
      rejectedReason = cause instanceof Error ? cause : new Error(String(cause));
      try { tx.abort(); }
      catch { rejectOnce(rejectedReason); }
    };
    tx.oncomplete = () => {
      if (finished) return;
      finished = true;
      resolve(outcome);
    };
    tx.onabort = () => rejectOnce(rejectedReason || transactionError(tx, null, "Transaction aborted."));
    tx.onerror = () => {
      // The request's unhandled error aborts the transaction. Wait for onabort.
    };
    try {
      schedule({
        store: name => tx.objectStore(name),
        setResult: value => { outcome = value; },
        abort,
      });
    } catch (cause) {
      abort(cause);
    }
  });
}

function validatedDigest(raw, digest) {
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
    throw error("BAD_CHECKSUM", "SHA-256 must be a lowercase 64-character digest.");
  }
  if (typeof raw !== "string") throw error("INVALID_SAVE", "Missing JSON bytes.");
  return digest;
}

function makeRevision(key, kind, raw, sha256, revision, careerId, schemaVersion, storedAt) {
  const id = encodeURIComponent(key) + ":" + revision + ":" + sha256;
  return {
    id, key, kind, raw, sha256, revision, careerId, schemaVersion, storedAt,
  };
}

function makeHead(revision) {
  const { key, kind, id, sha256, revision: ordinal, careerId, storedAt } = revision;
  return { key, kind, id, sha256, revision: ordinal, careerId, storedAt };
}

async function checkReadback(head, revision, hashText) {
  if (!isRecord(head) || !isRecord(revision) ||
      head.id !== revision.id || head.sha256 !== revision.sha256 ||
      head.revision !== revision.revision ||
      head.key !== revision.key || head.kind !== revision.kind ||
      head.careerId !== revision.careerId ||
      revision.id !== encodeURIComponent(head.key) + ":" +
        head.revision + ":" + head.sha256) {
    throw error("DAMAGED_SAVE", "The durable pointer and immutable revision disagree.");
  }
  const checkedSave = compatibleSave(head.key, head.kind, revision.raw);
  if (checkedSave.careerId !== head.careerId ||
      checkedSave.schemaVersion !== revision.schemaVersion) {
    throw error("DAMAGED_SAVE", "Stored career identity or save schema was modified.");
  }
  const digest = await hashText(revision.raw);
  if (digest !== head.sha256) {
    throw error("BAD_CHECKSUM", "The durable revision checksum does not match its bytes.");
  }
  return revision;
}

export async function openDurableCareerDatabase({
  indexedDBFactory = globalThis.indexedDB,
  databaseName = DURABLE_DB_NAME,
} = {}) {
  if (!indexedDBFactory || typeof indexedDBFactory.open !== "function") {
    throw error("STORAGE_UNAVAILABLE", "IndexedDB is not available in this browser.");
  }
  const db = await new Promise((resolve, reject) => {
    let request;
    try { request = indexedDBFactory.open(databaseName, DURABLE_DB_VERSION); }
    catch (cause) { reject(cause); return; }
    let settled = false;
    const rejectOnce = cause => {
      if (settled) return;
      settled = true;
      reject(cause || error("STORAGE_UNAVAILABLE", "IndexedDB could not open."));
    };
    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        for (const store of [DURABLE_REVISIONS_STORE, DURABLE_HEADS_STORE, DURABLE_META_STORE]) {
          if (!database.objectStoreNames.contains(store)) {
            database.createObjectStore(store, { keyPath: store === DURABLE_HEADS_STORE ||
              store === DURABLE_META_STORE ? "key" : "id" });
          }
        }
      } catch (cause) { rejectOnce(cause); }
    };
    request.onerror = () => rejectOnce(request.error);
    request.onblocked = () => rejectOnce(
      error("STORAGE_BLOCKED", "Another tab is blocking the IndexedDB database upgrade."));
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      resolve(request.result);
    };
  });

  const read = (storeName, key) => transaction(db, [storeName], "readonly",
    ({ store, setResult }) => {
      const req = store(storeName).get(key);
      req.onsuccess = () => setResult(req.result ?? null);
    });

  const readAll = storeName => transaction(db, [storeName], "readonly",
    ({ store, setResult }) => {
      const req = store(storeName).getAll();
      req.onsuccess = () => setResult(req.result);
    });

  return {
    getHead: key => read(DURABLE_HEADS_STORE, key),
    getRevision: id => read(DURABLE_REVISIONS_STORE, id),
    listHeads: () => readAll(DURABLE_HEADS_STORE),
    getStage: () => read(DURABLE_META_STORE, DURABLE_STAGE_KEY),

    readCurrentPair: key => transaction(db,
      [DURABLE_HEADS_STORE, DURABLE_REVISIONS_STORE], "readonly",
      ({ store, setResult }) => {
        const headRequest = store(DURABLE_HEADS_STORE).get(key);
        headRequest.onsuccess = () => {
          const head = headRequest.result;
          if (!head) { setResult(null); return; }
          const revisionRequest = store(DURABLE_REVISIONS_STORE).get(head.id);
          revisionRequest.onsuccess = () => setResult({
            head, revision: revisionRequest.result ?? null,
          });
        };
      }),

    commitOne: ({ key, expectedRevision, prepared, allowCareerSwitch = false }) =>
      transaction(db, [DURABLE_HEADS_STORE, DURABLE_REVISIONS_STORE],
        "readwrite", ({ store, setResult, abort }) => {
          const heads = store(DURABLE_HEADS_STORE);
          const revisions = store(DURABLE_REVISIONS_STORE);
          const req = heads.get(key);
          req.onsuccess = () => {
            try {
              const previous = req.result ?? null;
              const actual = previous?.revision ?? null;
              if (actual !== expectedRevision) {
                abort(error("REVISION_CONFLICT", "A newer save was written by another tab."));
                return;
              }
              if (previous && previous.careerId !== prepared.careerId &&
                  !(allowCareerSwitch && prepared.kind === "continue")) {
                abort(error("CAREER_CONFLICT", "The selected slot belongs to another career."));
                return;
              }
              const next = makeRevision(key, prepared.kind, prepared.raw,
                prepared.sha256, (actual ?? 0) + 1,
                prepared.careerId, prepared.schemaVersion, prepared.storedAt);
              const head = makeHead(next);
              revisions.add(next);
              heads.put(head);
              setResult(head);
            } catch (cause) { abort(cause); }
          };
        }),

    // Stage all legacy saves in ONE atomic transaction. If quota is exceeded,
    // no pointer or revision is committed. The stage is inert: it cannot turn
    // IndexedDB into an authoritative backend or change any game session.
    stageBatchIfEmpty: (prepared, timestamp) =>
      transaction(db, [DURABLE_HEADS_STORE, DURABLE_REVISIONS_STORE, DURABLE_META_STORE],
        "readwrite", ({ store, setResult, abort }) => {
          const heads = store(DURABLE_HEADS_STORE);
          const revisions = store(DURABLE_REVISIONS_STORE);
          const metadata = store(DURABLE_META_STORE);
          const markerRequest = metadata.get(DURABLE_STAGE_KEY);
          markerRequest.onsuccess = () => {
            if (markerRequest.result) {
              abort(error("STAGE_EXISTS", "A cutover stage already exists; existing data is preserved."));
              return;
            }
            const allRequest = heads.getAllKeys();
            allRequest.onsuccess = () => {
              if (allRequest.result.length > 0) {
                abort(error("STAGE_EXISTS", "IndexedDB already contains career saves."));
                return;
              }
              try {
                for (const entry of prepared) {
                  const revision = makeRevision(entry.key, entry.kind, entry.raw,
                    entry.sha256, 1, entry.careerId, entry.schemaVersion, timestamp);
                  revisions.add(revision);
                  heads.add(makeHead(revision));
                }
                metadata.add({
                  key: DURABLE_STAGE_KEY,
                  state: "staged",
                  stagedAt: timestamp,
                  slots: prepared.length,
                  schemaVersion: DURABLE_DB_VERSION,
                });
                setResult({ state: "staged", count: prepared.length });
              } catch (cause) { abort(cause); }
            };
          };
        }),

    // Rollback is metadata-only. It never destroys the old localStorage save,
    // nor the staged immutable IndexedDB revisions.
    rollbackStage: () => transaction(db, [DURABLE_META_STORE], "readwrite",
      ({ store, setResult, abort }) => {
        const meta = store(DURABLE_META_STORE);
        const req = meta.get(DURABLE_STAGE_KEY);
        req.onsuccess = () => {
          if (!req.result || req.result.state !== "staged") {
            abort(error("STAGE_NOT_READY", "There is no prepared cutover to roll back."));
            return;
          }
          meta.put({ ...req.result, state: "rolled_back" });
          setResult(true);
        };
      }),
    close: () => db.close(),
  };
}

export function durableRecoveryKey(careerId) {
  const seed = String(careerId || "").trim();
  if (!seed) throw error("MISSING_CAREER_ID", "Recovery requires a stable career seed.");
  return DURABLE_RECOVERY_PREFIX + encodeURIComponent(seed);
}

export function createDurableCareerRepository({
  database,
  hashText = sha256SaveText,
  now = () => new Date().toISOString(),
} = {}) {
  if (!database || typeof database.commitOne !== "function" ||
      typeof database.readCurrentPair !== "function") {
    throw new TypeError("An open transactional IndexedDB adapter is required.");
  }

  const prepare = async ({ key, kind, raw }) => {
    const { careerId, schemaVersion } = compatibleSave(key, kind, raw);
    const sha256 = validatedDigest(raw, await hashText(raw));
    return { key, kind, raw, sha256, careerId, schemaVersion, storedAt: now() };
  };

  const readCurrent = async key => {
    const pair = await database.readCurrentPair(key);
    if (!pair) return null;
    await checkReadback(pair.head, pair.revision, hashText);
    return { ...pair.head, raw: pair.revision.raw };
  };

  const commit = async ({ key, kind, raw, expectedRevision, allowCareerSwitch = false }) => {
    if (expectedRevision === undefined ||
        !(expectedRevision === null ||
          (Number.isSafeInteger(expectedRevision) && expectedRevision >= 1))) {
      throw error("EXPECTED_REVISION", "A current revision (or null for new slots) is required.");
    }
    const prepared = await prepare({ key, kind, raw });
    const head = await database.commitOne({
      key, expectedRevision, prepared, allowCareerSwitch,
    });
    const copied = await readCurrent(key);
    // A successful transaction is authoritative even if readback is blocked;
    // surface the error and never claim a verified write prematurely.
    if (!copied || copied.id !== head.id || copied.raw !== raw) {
      throw error("VERIFY_FAILED", "The committed revision could not be verified.");
    }
    return copied;
  };

  const writeCheckpoint = async ({ careerId, journal, expectedRevision }) => {
    if (!isRecord(journal) || String(journal.save_seed || "") !== String(careerId || "")) {
      throw error("CAREER_CONFLICT", "Recovery checkpoint belongs to a different career.");
    }
    return commit({
      key: durableRecoveryKey(careerId),
      kind: "recovery",
      raw: JSON.stringify(journal),
      expectedRevision,
    });
  };

  const recoverCheckpoint = async state => {
    const seed = state?.saveMeta?.seed;
    if (!seed) return state;
    const pointer = await readCurrent(durableRecoveryKey(seed));
    if (!pointer) return state;
    const recovery = JSON.parse(pointer.raw);
    return sessionRecoveryMatchesState(state, recovery)
      ? applySessionRecoverySnapshot(state, recovery) : state;
  };

  const stageLegacy = async storage => {
    if (!storage) throw new TypeError("Legacy storage must be provided.");
    const legacy = createLegacyCareerRepository({ storage });
    const candidates = legacy.migrationCandidates();
    if (!candidates.length) {
      throw error("NO_SAVES", "There are no legacy saves to stage.");
    }
    const prepared = [];
    for (const item of candidates) {
      prepared.push(await prepare(item));
    }
    // Check the source before the transaction; this cannot lock localStorage
    // against other tabs, so the source is rechecked after the transaction.
    for (const item of prepared) {
      if (storage.getItem(item.key) !== item.raw) {
        throw error("SOURCE_CHANGED", "A legacy save changed during preparation.");
      }
    }
    const result = await database.stageBatchIfEmpty(prepared, now());
    for (const item of prepared) {
      if (storage.getItem(item.key) !== item.raw) {
        throw error("SOURCE_CHANGED",
          "Legacy data changed during staging; activation is not permitted.");
      }
      const checked = await readCurrent(item.key);
      if (!checked || checked.raw !== item.raw || checked.revision !== 1) {
        throw error("VERIFY_FAILED", "Staged IndexedDB copies failed readback.");
      }
    }
    return { ...result, verified: true };
  };

  return {
    readCurrent,
    commit,
    writeCheckpoint,
    recoverCheckpoint,
    stageLegacy,
    readStage: () => database.getStage(),
    rollbackStage: () => database.rollbackStage(),
    listHeads: () => database.listHeads(),
    close: () => database.close(),
  };
}
