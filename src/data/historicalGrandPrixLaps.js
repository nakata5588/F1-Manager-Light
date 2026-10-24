// Scheduled Grand Prix race distances absent from the canonical Calendar Excel
// export. These are pre-race event facts, not historical finishing results.
// 1980 source: https://www.formula1.com/en/results/1980/races
// Key by actual race date: circuit-specific lap counts must never be inferred
// from a generic 305 km target when a sourced event count is known.
//
// This deliberately supplements (rather than rewrites) the official workbook.
// If Calendar gains an explicit laps/race_laps column, that value takes priority.
export const F1_1980_OFFICIAL_RACE_LAPS = Object.freeze({
  "1980-01-13": 53, // Argentina
  "1980-01-27": 40, // Brazil
  "1980-03-01": 78, // South Africa
  "1980-03-30": 80, // USA West (Long Beach)
  "1980-05-04": 72, // Belgium
  "1980-05-18": 76, // Monaco
  "1980-06-29": 54, // France
  "1980-07-13": 76, // Great Britain
  "1980-08-10": 45, // Germany
  "1980-08-17": 54, // Austria
  "1980-08-31": 72, // Netherlands
  "1980-09-14": 60, // Italy
  "1980-09-28": 70, // Canada
  "1980-10-05": 59, // USA East (Watkins Glen)
});

export function historicalGrandPrixLaps(gp, year) {
  if (Number(year) !== 1980 || !gp) return null;
  // Only apply to canonical F1 event entities, not generic test tracks.
  const trackId = String(gp.track_id ?? gp.circuit_id ?? "");
  if (!/^tr_\\d+$/.test(trackId)) return null;
  const date = String(gp.race_date ?? gp.dateISO ?? gp.date ?? "").slice(0, 10);
  return F1_1980_OFFICIAL_RACE_LAPS[date] ?? null;
}
