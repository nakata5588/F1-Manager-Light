// src/domain/raceWeekendCompatibility.js
// Compatibility helpers for persisted Race Weekend state.
//
// Current saves use:
//   startingGrid: { rows: [...] }
//   grid: [...]
// Older/imported saves may contain the same rows as an array, a keyed object,
// or inside legacy containers. Keep all Race Weekend consumers on one resolver.

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ROW_CONTAINER_KEYS = [
  "rows",
  "items",
  "list",
  "data",
  "entries",
  "classification",
  "grid",
];

function rowCollection(value) {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];

  for (const key of ROW_CONTAINER_KEYS) {
    if (value[key] == null) continue;
    const nested = rowCollection(value[key]);
    if (nested.length) return nested;
  }

  return Object.entries(value).flatMap(([key, row]) => {
    if (!isRecord(row)) return [];
    const hasDriverId =
      row.driver_id != null ||
      row.driverId != null ||
      row.driver?.driver_id != null ||
      row.id != null;

    if (hasDriverId) return [row];

    // Some old exports keyed the grid by canonical driver id.
    if (/^d[_-]?\d+$/i.test(String(key))) {
      return [{ ...row, driver_id: key }];
    }

    return [row];
  });
}

export function raceWeekendGridRows(weekend) {
  if (!isRecord(weekend)) return [];

  const candidates = [
    isRecord(weekend.startingGrid) ? weekend.startingGrid.rows : null,
    weekend.startingGrid,
    weekend.grid,
  ];

  for (const candidate of candidates) {
    const rows = rowCollection(candidate);
    if (rows.length) return rows;
  }

  return [];
}

export function normalizeRaceWeekendGrid(weekend) {
  if (!isRecord(weekend)) return weekend;

  const hasPersistedGrid = weekend.startingGrid != null || weekend.grid != null;
  if (!hasPersistedGrid) return weekend;

  const rows = raceWeekendGridRows(weekend);
  const startingGridMeta =
    isRecord(weekend.startingGrid) && !Array.isArray(weekend.startingGrid)
      ? weekend.startingGrid
      : {};

  return {
    ...weekend,
    startingGrid: {
      ...startingGridMeta,
      rows,
    },
    // Keep the legacy alias array-shaped as expected by current engines.
    grid: rows,
  };
}
