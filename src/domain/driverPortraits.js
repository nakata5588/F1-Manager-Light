// src/domain/driverPortraits.js
// Driver portrait registry.
//
// Portraits are keyed by the canonical runtime driver_id generated into
// public/data, never by display name or legacy ids.
//
// A driver may have:
// - default: one timeless portrait used in any season;
// - history: optional year-specific variants.
//
// Resolution policy for historical variants:
// 1) latest portrait whose year <= activeYear;
// 2) if none exists, nearest future portrait;
// 3) if there are no historical variants, use the timeless default;
// 4) external/custom fallback;
// 5) UI initials.
//
// Paths are explicit, so .webp, .png, .jpg and .jpeg can coexist.

const portraitSet = (defaultPath, history = []) => Object.freeze({
  default: defaultPath || "",
  history: Object.freeze(
    [...history]
      .filter((row) => row?.path)
      .map((row) => Object.freeze({ year: Number(row.year), path: String(row.path) }))
      .sort((a, b) => a.year - b.year)
  ),
});

const DRIVER_PORTRAITS = Object.freeze({
  d_0110: portraitSet("/portraits/drivers/d_0110.webp"), // Andrea de Cesaris
  d_0117: portraitSet("/portraits/drivers/d_0117.webp"), // Alain Prost
  d_0119: portraitSet("/portraits/drivers/d_0119.webp"), // Riccardo Patrese
  d_0137: portraitSet("/portraits/drivers/d_0137.webp"), // Nelson Piquet
  d_0152: portraitSet("/portraits/drivers/d_0152.webp"), // Bruno Giacomelli
  d_0163: portraitSet("/portraits/drivers/d_0163.webp"), // Rene Arnoux
  d_0172: portraitSet("/portraits/drivers/d_0172.webp"), // Jacques Laffite
  d_0173: portraitSet("/portraits/drivers/d_0173.webp"), // Elio de Angelis
  d_0177: portraitSet("/portraits/drivers/d_0177.webp"), // Keke Rosberg
  d_0178: portraitSet("/portraits/drivers/d_0178.webp"), // Alan Jones
  d_0187: portraitSet("/portraits/drivers/d_0187.webp"), // John Watson
  d_0197: portraitSet("/portraits/drivers/d_0197.webp"), // Jean-Pierre Jarier
  d_0199: portraitSet("/portraits/drivers/d_0199.webp"), // Carlos Reutemann
  d_0200: portraitSet("/portraits/drivers/d_0200.webp"), // Jochen Mass
  d_0202: portraitSet("/portraits/drivers/d_0202.webp"), // Didier Pironi
  d_0203: portraitSet("/portraits/drivers/d_0203.webp"), // Gilles Villeneuve
  d_0205: portraitSet("/portraits/drivers/d_0205.webp"), // Brian Henton
  d_0206: portraitSet("/portraits/drivers/d_0206.webp"), // Derek Daly
  d_0207: portraitSet("/portraits/drivers/d_0207.webp"), // Mario Andretti
  d_0213: portraitSet("/portraits/drivers/d_0213.webp"), // Beppe Gabbiani
  d_0219: portraitSet("/portraits/drivers/d_0219.webp"), // Jean-Pierre Jabouille
  d_0222: portraitSet("/portraits/drivers/d_0222.webp"), // Jody Scheckter
  d_0224: portraitSet("/portraits/drivers/d_0224.webp"), // Emerson Fittipaldi
});

const MANAGED_PORTRAIT_PREFIX = "/portraits/drivers/";

function driverIdOf(driver) {
  return String(driver?.driver_id ?? driver?.id ?? driver?.driverId ?? driver?.code ?? "");
}

function safePortraitFallback(fallback) {
  const value = String(fallback || "");
  // Managed local portrait paths are registry-owned. Dropping an unknown one
  // prevents old saves from keeping a portrait that belonged to a legacy id.
  return value.startsWith(MANAGED_PORTRAIT_PREFIX) ? "" : value;
}

function normalizePortraitSet(entry) {
  // Compatibility with the first registry format, which was an array of
  // { year, path } rows.
  if (Array.isArray(entry)) return portraitSet("", entry);
  if (!entry || typeof entry !== "object") return portraitSet("");
  return portraitSet(entry.default || "", Array.isArray(entry.history) ? entry.history : []);
}

export function driverPortraitSet(driverId) {
  return normalizePortraitSet(DRIVER_PORTRAITS[String(driverId || "")]);
}

export function driverPortraitTimeline(driverId) {
  return driverPortraitSet(driverId).history;
}

export function resolvePortraitSet(entry, activeYear, fallback = "") {
  const set = normalizePortraitSet(entry);
  const safeFallback = safePortraitFallback(fallback);
  const history = set.history;

  if (!history.length) return set.default || safeFallback;

  const year = Number(activeYear);
  if (!Number.isFinite(year)) {
    return history[history.length - 1]?.path || set.default || safeFallback;
  }

  let latestPast = null;
  for (const portrait of history) {
    if (Number(portrait.year) <= year) latestPast = portrait;
    else break;
  }
  if (latestPast?.path) return latestPast.path;

  const nearestFuture = history.find((portrait) => Number(portrait.year) > year);
  return nearestFuture?.path || set.default || safeFallback;
}

export function resolveDriverPortrait(driverId, activeYear, fallback = "") {
  const entry = DRIVER_PORTRAITS[String(driverId || "")];
  if (!entry) return safePortraitFallback(fallback);
  return resolvePortraitSet(entry, activeYear, fallback);
}

export function hydrateDriverPortraitRows(rows, activeYear) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((driver) => {
    if (!driver || typeof driver !== "object") return driver;
    const driverId = driverIdOf(driver);
    return {
      ...driver,
      portrait_path: resolveDriverPortrait(
        driverId,
        activeYear,
        driver.portrait_path ?? driver.portrait ?? ""
      ),
    };
  });
}

export { DRIVER_PORTRAITS };
