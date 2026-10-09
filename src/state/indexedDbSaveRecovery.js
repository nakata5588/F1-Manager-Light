// Explicit, reversible recovery of checksum-verified IndexedDB shadow copies.
// Never chooses an active save or overwrites Continue, pointers or old slots.
// The player may load the NEW recovered slot from the existing Load Game UI.
import { extractGameStateFromStoredSave } from "../core/saveSafety.js";
import {
  openIndexedDbShadowArchive,
  sha256SaveText,
} from "./indexedDbSaveArchive.js";

const SAVE_PREFIX = "f1ml_save_";
const CONTINUE_KEY = "f1hm_save";
const POINTER_KEY = "f1ml_last_save_key";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function verifyIndexedDbSaveRevision(entry, hashText = sha256SaveText) {
  if (!isRecord(entry) || typeof entry.raw !== "string" ||
      typeof entry.legacyKey !== "string" || typeof entry.sha256 !== "string" ||
      !["manual", "continue"].includes(entry.kind) ||
      !Number.isSafeInteger(entry.length) || entry.length !== entry.raw.length) {
    throw new Error("Archived save metadata is damaged or incomplete.");
  }
  if (!/^[0-9a-f]{64}$/.test(entry.sha256) ||
      entry.id !== encodeURIComponent(entry.legacyKey) + ":" + entry.sha256) {
    throw new Error("Archived save revision identity does not match its checksum.");
  }
  if (entry.kind === "continue" && entry.legacyKey !== CONTINUE_KEY) {
    throw new Error("Archived Continue identity is not valid.");
  }
  if (entry.kind === "manual" && !entry.legacyKey.startsWith(SAVE_PREFIX)) {
    throw new Error("Archived manual slot identity is not valid.");
  }
  const computedHash = await hashText(entry.raw);
  if (computedHash !== entry.sha256) {
    throw new Error("Archived save checksum does not match its bytes.");
  }
  let parsed;
  try {
    parsed = JSON.parse(entry.raw);
  } catch {
    throw new Error("Archived save JSON is unreadable.");
  }
  if (!isRecord(parsed)) throw new Error("Archived save is not a valid object.");
  if (entry.kind === "manual" && !isRecord(parsed.gameState)) {
    throw new Error("Archived manual save envelope is incomplete.");
  }
  if (entry.kind === "continue" && isRecord(parsed.gameState)) {
    throw new Error("Archived Continue snapshot is not flat.");
  }
  const gameState = extractGameStateFromStoredSave(parsed);
  if (!isRecord(gameState)) throw new Error("Archived career state could not be loaded.");

  return {
    parsed,
    gameState,
    name: String(parsed?.meta?.name || "").trim(),
    year: gameState.activeYear ?? gameState.seasonYear ?? null,
    seed: gameState.saveMeta?.seed ?? null,
    phase: gameState.raceWeekendState?.phase ?? null,
  };
}

export async function listIndexedDbSaveRevisions({
  archive = null,
  indexedDBFactory = globalThis.indexedDB,
  hashText = sha256SaveText,
} = {}) {
  const source = archive || await openIndexedDbShadowArchive({ indexedDBFactory });
  try {
    const rawEntries = await source.list();
    if (!Array.isArray(rawEntries)) throw new Error("Archive listing returned no array.");
    const list = [];
    for (const entry of rawEntries) {
      const item = {
        id: entry?.id ?? null,
        legacyKey: entry?.legacyKey ?? null,
        kind: entry?.kind ?? null,
        savedAt: entry?.savedAt ?? null,
        capturedAt: entry?.capturedAt ?? null,
        bytes: entry?.length ?? null,
        verified: false,
      };
      try {
        const info = await verifyIndexedDbSaveRevision(entry, hashText);
        Object.assign(item, {
          verified: true,
          name: info.name || (entry.kind === "continue" ? "Continue" : "Unnamed save"),
          year: info.year,
          phase: info.phase,
        });
      } catch (error) {
        item.error = String(error?.message || error);
      }
      list.push(item);
    }
    list.sort((a, b) => {
      const date = v => Date.parse(v?.capturedAt || v?.savedAt || "") || 0;
      return date(b) - date(a);
    });
    return list;
  } finally {
    if (!archive) source.close();
  }
}

function uniqueRecoveredSuffix() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("A secure random ID is required to recover a new slot.");
  return uuid;
}

// Game state is restored unchanged into a NEW legacy manual save envelope.
// Restore metadata is stamped so Load Game clearly shows the recovered copy.
// No active career change is made here. On failure, all PREVIOUS slots remain.
export async function restoreIndexedDbSaveAsNewSlot({
  id,
  storage,
  archive = null,
  indexedDBFactory = globalThis.indexedDB,
  hashText = sha256SaveText,
  newSlotSuffix = uniqueRecoveredSuffix,
  now = () => new Date(),
} = {}) {
  if (!storage || typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function") {
    throw new TypeError("A writable legacy Web Storage backend is required.");
  }
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("Choose an archived save revision to recover.");
  }
  const source = archive || await openIndexedDbShadowArchive({ indexedDBFactory });
  try {
    const entry = await source.get(id);
    if (!entry) throw new Error("Archived save revision was not found.");
    const info = await verifyIndexedDbSaveRevision(entry, hashText);
    const stamp = now().toISOString();
    const sourceName = info.name || (entry.kind === "continue"
      ? "Continue " + String(info.year ?? "Career") : "Archived save");
    const originalMeta = entry.kind === "manual" && isRecord(info.parsed.meta)
      ? info.parsed.meta : {};
    const output = JSON.stringify({
      meta: {
        ...originalMeta,
        name: "Recovered — " + sourceName,
        savedAt: stamp,
        recoveredFrom: entry.sha256,
      },
      gameState: entry.kind === "manual" ? info.parsed.gameState : info.parsed,
    });

    // Verify the envelope before writing anything into the active store.
    const parsed = JSON.parse(output);
    const roundTrip = extractGameStateFromStoredSave(parsed);
    if (!isRecord(roundTrip) || String(roundTrip.saveMeta?.seed ?? "") !== String(info.seed ?? "")) {
      throw new Error("Recovered save did not pass compatibility validation.");
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const suffix = String(newSlotSuffix() ?? "");
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(suffix)) {
        throw new Error("A safe unique save slot identifier is required.");
      }
      const key = SAVE_PREFIX + "recovered_" + suffix;
      if (storage.getItem(key) !== null) continue;
      storage.setItem(key, output);
      if (storage.getItem(key) !== output) {
        throw new Error("Recovered save write could not be confirmed.");
      }
      // Never update f1hm_save or f1ml_last_save_key. The user explicitly
      // selects the recovered slot through the existing Load Game flow.
      return { ok: true, key, sourceId: id, kind: entry.kind, savedAt: stamp };
    }
    throw new Error("Could not allocate a new, non-colliding recovery slot.");
  } finally {
    if (!archive) source.close();
  }
}

// Explicitly restoring a recovered slot and then using Load Game is the
// reversible path. We intentionally do NOT toggle an authoritative backend:
// legacy localStorage remains canonical until a separately tested cutover.
export const SAVE_RECOVERY_CURRENT_BACKEND = "localStorage";
