# P1 — Save architecture and durability plan

Status: incremental design boundary. Do **not** assume IndexedDB, compression or
a new on-disk schema has already shipped. This document describes the existing
repository as inspected on 2026-10-09 and the safe migration sequence.

## Existing authoritative paths

| Concern | Current owner | Persistence |
| --- | --- | --- |
| Manual Save As / overwrite / Quick Save | `src/state/manualSavePersistence.js`, called by `GameStore.js` | `localStorage` keys `f1ml_save_*` (envelope `{meta,gameState}`) |
| Continue rolling snapshot | `GameStore.js` | `localStorage.f1hm_save` (flat state) |
| Last manual save pointer | `manualSavePersistence.js` | `localStorage.f1ml_last_save_key` |
| Refresh/race recovery | `sessionRecovery.js`, `GameStore.js` | `sessionStorage.f1ml_session_recovery` |
| Save migration & normalization | `src/core/saveSafety.js` | schema v0 → v1 → v2, CURRENT v2 |
| Reference source | `public/data` generated from canonical DB | rebuilt/loaded externally, not a career's authority |

The current manual-save writer confirms slot bytes after writing and does not
evict previous saves on storage quota errors. The Continue mirror and last-slot
pointer can separately fail. Never report them as durable unless confirmed.

## Logical ownership, not yet a new disk format

`src/core/saveSections.js` defines four in-memory partitions:

1. **referenceData**: precisely the established `db*` reference-key list
   formerly kept as `HEAVY_KEYS` in GameStore. Not written to legacy manual
   saves. Its source is the appropriate curated/generated season data.
2. **careerState**: finances, contracts, current standings, staff, lower-series
   world and all other gameplay state. Unknown new keys default here; no
   silent dropping.
3. **activeRace**: `raceEntryState` and entire `raceWeekendState`, including
   canonical live runner state, RNG and tyres. No compaction or recomputation.
4. **archivedResults**: `results`, `resultsHistory` and `historySeasons`.
   Store official outcomes, not a second result calculation.

The key-order-preserving assembly function still emits the **same flat v2
gameState** and the same `{meta,gameState}` manual envelope. No existing file,
save key, import/export shape or schema number changes in this increment.
Tests check byte-compatible field ordering, classification and full round-trip.

Do **not** confuse this in-memory layout version with
`SAVE_SCHEMA_VERSION` from `saveSafety.js`.

## Existing recovery exception

`compactRaceWeekendForRecovery` currently drops only two derived forecast
arrays (`projected_race` and `projected_summary`) from a *running* legacy
live-race **tab-refresh journal**; the canonical/authoritative state remains
in the manually saved and Continue gameState. This workaround predates the
four-way partition and avoids sessionStorage quota exhaustion.

**No additional active race data may be compacted.** Before changing this
exception, verify canonical resume parity, journal size and browser refresh
under x1/x8/x16. Future archive compaction may apply *only* to confirmed
completed sessions, after Results have been durably archived and checksummed.
Never trim official classification, lap timing, DNF or event history for a
space-saving shortcut.

## Same-career stale journal guard (incremental hardening)

A matching career seed alone does not prove journal freshness. Legacy
sessionStorage checkpoints can survive into later rounds of the *same*
career. Until durable revisions exist, recovery now rejects checkpoints
that are older by known season, round or date, belong to another GP at
the same point, rewind canonical ticks, or try to reopen finished Results.
It continues to accept a newer matching journal after a stale Continue
snapshot. Explicit manual Load Game and imported game state invalidate
the previous tab's journal without deleting any save slot.

This is **not** a complete multi-tab concurrency protocol. The planned
IndexedDB revision/checksum transaction remains necessary.

## Proposed IndexedDB rollout (future PRs)

**Phase A — compatibility baseline (this PR).** Central ownership map and
automated no-loss tests. Keep all writes/readers synchronous and unchanged.

**Phase B — storage abstraction.** Introduce an asynchronous repository
interface (`readSlot`, `writeSlotAtomically`, `listSlots`,
`readRecovery`, `writeRecovery`, `exportSlot`) behind the existing
UI actions. Make writing/verification status explicit, including Continue
mirror failures. Cover quota, denied access, forced shutdown and multi-tab
concurrency. Maintain localStorage legacy readers.

**Phase C — IndexedDB opt-in migration.** Version a database such as
`f1ml-careers` with stores for save slots, revision/pointers and recovery
checkpoints. Persist sections in a single transaction with career ID,
monotonic revision, save-schema version and checksum. Copy each localStorage
save to IndexedDB, read it back and validate checksum + migration; **do not
delete or overwrite** the original localStorage copy. Only enable the new
reader/writer after round-trip verification. Fallback to legacy import/export
when IndexedDB is unavailable. Avoid duplicate authoritative save copies.

**Phase D — durable recovery.** Persist a journal/checkpoint with stable
career ID, snapshot revision, canonical race seed/tick and completion state.
Reject recovery from another career or an older/foreign race. Recover from the
last verified durable checkpoint after browser closure, not solely from a
single tab's sessionStorage. Keep archived Results immutable.

**Phase E — compatibility and longitudinal soak.** For schema v0/v1/v2 and
the future explicit v3, test manual save, Quick Save, Continue, Save As,
export/import, refresh while racing, full reload, race finalization, next
season and multiple seasons. Test interrupted writes, quota, two tabs,
duplicate saves, old game versions and updates to reference data. Back
compatibility must not apply future historical results to a simulated career.

## Versioned provenance required before a disk-format switch

Persist the **starting era and career seed**, save schema, season-pack/data
revision and versions of simulation/rating/rule models in save metadata.
Avoid copying all reference rows per save by default, but pin enough facts or
a compatible snapshot for deterministic replay when historical assets change.
Existing `careerBoundary.js` must remain the single gate preventing
knowledge of real results *after* the user's simulated career date. Do not
begin that change under this PR: it belongs to roadmap item 04.

## Merge conditions for this increment

- `npm run test:save-safety` and `npm run check` green.
- Full existing GitHub CI green.
- Manual save envelope still `{meta,gameState}`; Continue still a flat object.
- Full live Race Weekend runtime and official archived Results unchanged.
- Unknown gameplay keys survive; reference rows are excluded as before.
- No data, Race Weekend engine or UI changes.
