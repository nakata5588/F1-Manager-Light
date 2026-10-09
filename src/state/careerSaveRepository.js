// Synchronous compatibility port for current localStorage saves.
// Browser storage is injected so runtime flows and failures are testable.
// The manual writer remains the sole authority for Save As/overwrite/Quick Save.
export const LEGACY_SAVE_KEYS = Object.freeze({
  manualPrefix: "f1ml_save_",
  continue: "f1hm_save",
  lastManual: "f1ml_last_save_key",
});

export function createLegacyCareerRepository({
  storage,
  manualWriter = null,
  keys = LEGACY_SAVE_KEYS,
} = {}) {
  if (!storage || typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function") {
    throw new TypeError("A Web Storage compatible backend is required.");
  }

  // Legacy imports may have custom slot keys: do not narrow accepted keys.
  const readSlot = (key) => key ? storage.getItem(key) : null;

  const listManualSlots = () => {
    const slots = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(keys.manualPrefix)) continue;
      const raw = storage.getItem(key);
      let savedAt = 0;
      try {
        savedAt = Date.parse(JSON.parse(raw)?.meta?.savedAt || "");
      } catch {
        // Invalid slots must remain visible; never delete them automatically.
      }
      if (!Number.isFinite(savedAt) || savedAt <= 0) {
        // Match the existing fallback; old slot names may have a trailing epoch.
        const epoch = String(key).match(/(\d{10,})$/);
        if (epoch) savedAt = Number(epoch[1]);
      }
      slots.push({ key, savedAt: Number(savedAt) || 0, raw });
    }
    slots.sort((a, b) => b.savedAt - a.savedAt);
    return slots;
  };

  return {
    readSlot,
    listManualSlots,
    latestManualSaveKey: () => listManualSlots()[0]?.key || null,
    hasAnySave: () => Boolean(readSlot(keys.continue)) || listManualSlots().length > 0,
    getLastManualSaveKey: () => storage.getItem(keys.lastManual),
    readContinue: () => readSlot(keys.continue),
    saveManual: (args) => {
      if (typeof manualWriter !== "function") throw new Error("Manual save writer was not provided.");
      return manualWriter({ storage, ...args });
    },
    // Read-only export used by non-destructive migrations; preserve exact bytes.
    migrationCandidates: () => [
      ...listManualSlots().map(({ key, raw }) => ({ key, raw, kind: "manual" })),
      ...(readSlot(keys.continue) === null ? [] :
        [{ key: keys.continue, raw: readSlot(keys.continue), kind: "continue" }]),
    ],
  };
}
