// Opt-in, read-only-from-legacy IndexedDB migration archive.
// IMPORTANT: the game still loads and writes through legacy localStorage.
// This archive is *never* an authoritative save source until a separately
// versioned and regression-tested cutover is explicitly implemented.
import { extractGameStateFromStoredSave } from "../core/saveSafety.js";
import { createLegacyCareerRepository } from "./careerSaveRepository.js";

export const IDB_SHADOW_DATABASE = "f1ml-careers-shadow";
export const IDB_SHADOW_STORE = "verifiedLegacySnapshots";
export const IDB_SHADOW_VERSION = 1;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function settledTransaction(database, mode, method, value) {
  return new Promise((resolve, reject) => {
    let transaction;
    let request;
    try {
      transaction = database.transaction(IDB_SHADOW_STORE, mode);
      request = value === undefined
        ? transaction.objectStore(IDB_SHADOW_STORE)[method]()
        : transaction.objectStore(IDB_SHADOW_STORE)[method](value);
    } catch (error) {
      reject(error);
      return;
    }
    let finished = false;
    const fail = () => {
      if (finished) return;
      finished = true;
      reject(transaction.error || request.error || new Error("IndexedDB transaction failed."));
    };
    transaction.oncomplete = () => {
      if (finished) return;
      finished = true;
      resolve(request.result);
    };
    transaction.onabort = fail;
    transaction.onerror = fail;
    request.onerror = fail;
    // Do not report a successful add on request.onsuccess: the transaction
    // must commit first. In particular, quota errors can abort later.
  });
}

// Small native adapter: injected factory permits browser-independent tests.
// The add operation is immutable: neither a previous snapshot nor its
// contents can be silently replaced by concurrent tabs.
export async function openIndexedDbShadowArchive({
  indexedDBFactory = globalThis.indexedDB,
  databaseName = IDB_SHADOW_DATABASE,
} = {}) {
  if (!indexedDBFactory || typeof indexedDBFactory.open !== "function") {
    throw new Error("IndexedDB is unavailable; legacy saves were not modified.");
  }
  const database = await new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDBFactory.open(databaseName, IDB_SHADOW_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      reject(error || new Error("Could not open the IndexedDB save archive."));
    };
    req.onupgradeneeded = () => {
      try {
        if (!req.result.objectStoreNames.contains(IDB_SHADOW_STORE)) {
          req.result.createObjectStore(IDB_SHADOW_STORE, { keyPath: "id" });
        }
      } catch (error) {
        fail(error);
      }
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error("IndexedDB upgrade is blocked by another tab."));
    req.onsuccess = () => {
      if (finished) {
        req.result.close();
        return;
      }
      finished = true;
      resolve(req.result);
    };
  });
  return {
    get: (id) => settledTransaction(database, "readonly", "get", id),
    list: () => settledTransaction(database, "readonly", "getAll"),
    add: (entry) => settledTransaction(database, "readwrite", "add", entry),
    close: () => database.close(),
  };
}

export async function sha256SaveText(raw, cryptoProvider = globalThis.crypto) {
  if (typeof raw !== "string") throw new TypeError("Save bytes must be a string.");
  if (!cryptoProvider?.subtle?.digest) {
    throw new Error("SHA-256 Web Crypto unavailable; backup was not verified.");
  }
  const digest = await cryptoProvider.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function describeLegacySave(candidate) {
  const parsed = JSON.parse(candidate.raw);
  if (!record(parsed)) throw new Error("Save JSON must be an object.");
  if (candidate.kind === "manual" && !record(parsed.gameState)) {
    throw new Error("Manual slot has no gameState envelope.");
  }
  if (candidate.kind === "continue" && record(parsed.gameState)) {
    throw new Error("Continue must use the legacy flat gameState format.");
  }
  // Validate the existing v0/v1/v2 migration path without changing saved bytes.
  const gameState = extractGameStateFromStoredSave(parsed);
  if (!record(gameState)) throw new Error("Saved career state is not an object.");
  return {
    careerSeed: String(gameState.saveMeta?.seed || ""),
    schemaVersion: Number(gameState.saveMeta?.schemaVersion ?? 0),
    savedAt: candidate.kind === "manual" ? (parsed.meta?.savedAt ?? null) : null,
  };
}

// Copy historical save bytes to immutable, checksum-addressed revisions in
// IndexedDB. Originals, Continue and the last-slot pointer are NEVER touched.
// A copied record is only counted as verified after readback, hashing, and
// confirmation that the source bytes did not change during the copy.
export async function copyLegacySavesToIndexedDb({
  storage,
  shadowArchive = null,
  indexedDBFactory = globalThis.indexedDB,
  hashText = sha256SaveText,
} = {}) {
  const legacy = createLegacyCareerRepository({ storage });
  const candidates = legacy.migrationCandidates();
  const report = { ok: true, copied: 0, existing: 0, failed: 0, entries: [] };
  const archive = shadowArchive || await openIndexedDbShadowArchive({ indexedDBFactory });
  try {
    for (const candidate of candidates) {
      const entry = { key: candidate.key, kind: candidate.kind, status: "failed" };
      try {
        if (typeof candidate.raw !== "string" || candidate.raw.length === 0) {
          throw new Error("Empty or missing save slot.");
        }
        const meta = describeLegacySave(candidate);
        const sha256 = await hashText(candidate.raw);
        if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
          throw new Error("The save hash must be a 64-character SHA-256 digest.");
        }
        const id = encodeURIComponent(candidate.key) + ":" + sha256;
        const snapshot = {
          id,
          legacyKey: candidate.key,
          kind: candidate.kind,
          raw: candidate.raw,
          length: candidate.raw.length,
          capturedAt: new Date().toISOString(),
          sha256,
          ...meta,
        };
        let stored = await archive.get(id);
        let existed = Boolean(stored);
        if (!stored) {
          try {
            await archive.add(snapshot);
          } catch (error) {
            // A second tab may have added the same immutable revision first.
            if (error?.name !== "ConstraintError") throw error;
          }
          stored = await archive.get(id);
        }
        if (!record(stored) || stored.id !== snapshot.id ||
            stored.raw !== snapshot.raw || stored.sha256 !== snapshot.sha256 ||
            stored.length !== snapshot.length || stored.legacyKey !== snapshot.legacyKey ||
            stored.kind !== snapshot.kind) {
          throw new Error("IndexedDB readback does not match the legacy slot bytes.");
        }
        if (await hashText(stored.raw) !== sha256) {
          throw new Error("IndexedDB checksum verification failed.");
        }
        if (storage.getItem(candidate.key) !== candidate.raw) {
          throw new Error("Legacy source changed during copy; the new revision must be retried.");
        }
        entry.status = existed ? "already_verified" : "copied";
        entry.sha256 = sha256;
        report[existed ? "existing" : "copied"]++;
      } catch (error) {
        entry.error = String(error?.message || error);
        report.failed++;
        report.ok = false;
      }
      report.entries.push(entry);
    }
  } finally {
    if (!shadowArchive) archive.close();
  }
  return report;
}
