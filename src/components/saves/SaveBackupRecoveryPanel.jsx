import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { copyLegacySavesToIndexedDb } from "../../state/indexedDbSaveArchive.js";
import {
  listIndexedDbSaveRevisions,
  restoreIndexedDbSaveAsNewSlot,
} from "../../state/indexedDbSaveRecovery.js";

// Only user-initiated actions operate on IndexedDB. The game remains on its
// original localStorage backend, and restoring only creates a NEW manual slot.
export default function SaveBackupRecoveryPanel() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recoveredKey, setRecoveredKey] = useState("");

  const withFeedback = async (task, action) => {
    setBusy(task);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (problem) {
      setError(String(problem?.message || problem || "Unknown storage error."));
    } finally {
      setBusy("");
    }
  };

  const refresh = () => withFeedback("list", async () => {
    const items = await listIndexedDbSaveRevisions();
    setEntries(items);
    setMessage(items.length === 0
      ? "No IndexedDB backup copies found in this browser."
      : `${items.filter(entry => entry.verified).length} verified backup revision(s) available.`);
  });

  const createBackup = () => withFeedback("copy", async () => {
    const result = await copyLegacySavesToIndexedDb({ storage: window.localStorage });
    const items = await listIndexedDbSaveRevisions();
    setEntries(items);
    const summary = `${result.copied} new verified, ${result.existing} already verified, ${result.failed} failed.`;
    if (result.failed > 0) {
      setError("Some saves could not be copied: " + summary +
        " Original local saves have been preserved.");
      return;
    }
    setMessage(result.entries.length === 0
      ? "There are no local saves to copy."
      : "Backup verification completed: " + summary);
  });

  const recover = (entry) => {
    if (!entry.verified || busy) return;
    if (!window.confirm(
      "Recover this archived revision into a NEW manual save slot? " +
      "Your current game, Continue snapshot and existing saves will not be replaced."
    )) return;
    void withFeedback("restore:" + entry.id, async () => {
      const result = await restoreIndexedDbSaveAsNewSlot({
        id: entry.id,
        storage: window.localStorage,
      });
      setRecoveredKey(result.key);
      setMessage("A recovered manual save slot was created and verified. " +
        "Open Load Game to choose when to load it.");
    });
  };

  return <section className="rounded-2xl border border-white/10 bg-[#12141c] shadow-xl shadow-black/10">
    <div className="border-b border-white/10 px-5 py-4">
      <h2 className="text-lg font-semibold text-slate-100">Save Backups & Recovery</h2>
      <p className="mt-1 text-xs leading-5 text-slate-400">
        Experimental, optional IndexedDB archive on this device. The existing
        local saves remain the only active storage; backups are never created
        automatically and do not replace an exported save kept elsewhere.
      </p>
    </div>
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(busy)} onClick={createBackup}
          className="rounded-lg border border-emerald-400/30 bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50">
          {busy === "copy" ? "Verifying copies…" : "Copy & verify local saves"}
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={refresh}
          className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 hover:border-white/30 disabled:opacity-50">
          {busy === "list" ? "Checking archive…" : "View archived revisions"}
        </button>
        {recoveredKey ? <button type="button" onClick={() => navigate("/LoadGame")}
          className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-200 hover:bg-sky-400/15">
          Open Load Game
        </button> : null}
      </div>
      {message ? <p role="status" className="text-sm text-emerald-200">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      <p className="text-xs leading-5 text-slate-500">
        Recovery always creates a separate manual slot and requires you to select
        it in Load Game. It never overwrites Continue, archived Results or your
        last-played slot. Multiple revisions of a save can be kept. Clearing all
        browser/site data may remove both the original saves and these copies.
      </p>
      {entries ? <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          IndexedDB archive ({entries.length} revision{entries.length === 1 ? "" : "s"})
        </div>
        {entries.map((entry, index) => <div key={entry.id || index}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#171a23] px-3 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-sm font-semibold text-slate-200">
              {entry.verified ? entry.name : "Damaged archive revision"}
              {entry.year ? " — " + String(entry.year) : ""}
            </div>
            <div className="break-all text-xs text-slate-500">
              {entry.kind === "continue" ? "Continue copy" : "Manual save"}
              {" · "}{entry.capturedAt || entry.savedAt || "Date unavailable"}
              {" · "}{typeof entry.bytes === "number" ? Math.round(entry.bytes / 1024) + " KB" : "Unknown size"}
            </div>
            {entry.error ? <div className="text-xs text-rose-300">{entry.error}</div> : null}
          </div>
          <button type="button" disabled={Boolean(busy) || !entry.verified}
            onClick={() => recover(entry)}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-400/40 disabled:opacity-40">
            {busy === "restore:" + entry.id ? "Recovering…" : "Restore to new slot"}
          </button>
        </div>)}
      </div> : null}
    </div>
  </section>;
}
