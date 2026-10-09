// One manual-save write path for Save As, overwrite and Quick Save.
// Keeps the existing localStorage envelope and never removes previous saves.
export function isSaveQuotaError(error) {
  return Boolean(error) && (
    error.name === "QuotaExceededError" ||
    error.code === 22 ||
    error.code === 1014 ||
    /quota exceeded|exceeded the quota|storage is full/i.test(String(error.message || error))
  );
}

function failedSave(meta, error) {
  return {
    ok: false,
    key: null,
    meta,
    error: isSaveQuotaError(error)
      ? "Browser storage is full. The save was not written. Existing saves were preserved."
      : `Save failed: ${String(error?.message || error || "Unable to write to browser storage.")}`,
  };
}

// A cheap prefilter, not the authority for dedupe: a candidate duplicate is
// checked against the *entire* gameState actually stored in its save slot.
function fingerprint(text) {
  let a = 2166136261 >>> 0;
  let b = 5381 >>> 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    a = Math.imul(a ^ char, 16777619);
    b = (Math.imul(b, 33) ^ char) >>> 0;
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}

export function createManualSaveWriter({
  savePrefix = "f1ml_save_",
  lastSaveKey = "f1ml_last_save_key",
  continueKey = "f1hm_save",
  duplicateWindowMs = 1200,
  now = () => Date.now(),
  newSlotSuffix = () => Math.random().toString(36).slice(2, 12),
} = {}) {
  let previous = null;
  let writing = false;

  return function writeManualSave({ storage, gameState, meta, overwriteKey = null }) {
    if (writing) return failedSave(meta, new Error("Another save is in progress."));
    writing = true;
    try {
      const serializedState = JSON.stringify(gameState);
      const signature = fingerprint(serializedState);
      const careerId = String(gameState?.saveMeta?.seed ?? meta?.seed ?? "");
      const destination = overwriteKey || null;
      const timestamp = now();

      if (
        previous &&
        timestamp - previous.time >= 0 &&
        timestamp - previous.time < duplicateWindowMs &&
        previous.signature === signature &&
        previous.careerId === careerId &&
        previous.destination === destination &&
        previous.name === meta.name
      ) {
        // Never report a previous success for a different state or a deleted,
        // corrupted or externally overwritten slot, even if hashes collide.
        const stored = storage.getItem(previous.result.key);
        if (stored) {
          try {
            if (JSON.stringify(JSON.parse(stored).gameState) === serializedState) {
              return previous.result;
            }
          } catch {
            // Treat an unreadable slot as needing a fresh write.
          }
        }
      }

      let key = destination;
      if (!key) {
        // Save As creates a new slot. Avoid same-millisecond overwrites and
        // collisions with saves made in another tab.
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = `${savePrefix}${timestamp}_${newSlotSuffix()}`;
          if (storage.getItem(candidate) === null) {
            key = candidate;
            break;
          }
        }
        if (!key) return failedSave(meta, new Error("Could not allocate a unique save slot."));
      }

      // A failed setItem must leave all existing save slots untouched.
      const serializedSave = JSON.stringify({ meta, gameState });
      try {
        storage.setItem(key, serializedSave);
        if (storage.getItem(key) !== serializedSave) {
          return failedSave(meta, new Error("Browser storage did not confirm the save write."));
        }
      } catch (error) {
        return failedSave(meta, error);
      }

      // The manual slot is durable at this point. A separate failure updating
      // Continue or the last-played pointer must not claim the manual slot failed.
      let lastSavePointerOk = false;
      let continueSnapshotOk = false;
      try {
        storage.setItem(lastSaveKey, key);
        lastSavePointerOk = storage.getItem(lastSaveKey) === key;
      } catch {
        // The previous pointer is preserved on quota errors.
      }
      try {
        storage.setItem(continueKey, serializedState);
        continueSnapshotOk = storage.getItem(continueKey) === serializedState;
      } catch {
        // Never evict manual saves to make room for Continue.
      }

      const result = { ok: true, key, meta, lastSavePointerOk, continueSnapshotOk };
      previous = { time: timestamp, name: meta.name, careerId, destination, signature, result };
      return result;
    } catch (error) {
      return failedSave(meta, error);
    } finally {
      // A synchronous write does not need a delayed mutex release.
      writing = false;
    }
  };
}
