// src/domain/driverPortraits.js
// Historical driver portrait registry.
//
// Portraits are keyed by the canonical runtime driver_id generated into
// public/data, never by display name or by legacy ids from data/drivers.json.
// Paths are explicit, so .webp, .png, .jpg and .jpeg can coexist.

const DRIVER_PORTRAITS = Object.freeze({
  d_0110: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0110.webp" }]), // Andrea de Cesaris
  d_0117: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0117.webp" }]), // Alain Prost
  d_0119: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0119.webp" }]), // Riccardo Patrese
  d_0137: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0137.webp" }]), // Nelson Piquet
  d_0152: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0152.webp" }]), // Bruno Giacomelli
  d_0163: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0163.webp" }]), // Rene Arnoux
  d_0172: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0172.webp" }]), // Jacques Laffite
  d_0173: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0173.webp" }]), // Elio de Angelis
  d_0177: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0177.webp" }]), // Keke Rosberg
  d_0178: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0178.webp" }]), // Alan Jones
  d_0187: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0187.webp" }]), // John Watson
  d_0197: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0197.webp" }]), // Jean-Pierre Jarier
  d_0199: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0199.webp" }]), // Carlos Reutemann
  d_0200: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0200.webp" }]), // Jochen Mass
  d_0202: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0202.webp" }]), // Didier Pironi
  d_0203: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0203.webp" }]), // Gilles Villeneuve
  d_0205: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0205.webp" }]), // Brian Henton
  d_0206: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0206.webp" }]), // Derek Daly
  d_0207: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0207.webp" }]), // Mario Andretti
  d_0213: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0213.webp" }]), // Beppe Gabbiani
  d_0219: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0219.webp" }]), // Jean-Pierre Jabouille
  d_0222: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0222.webp" }]), // Jody Scheckter
  d_0224: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0224.webp" }]), // Emerson Fittipaldi
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

export function driverPortraitTimeline(driverId) {
  return DRIVER_PORTRAITS[String(driverId || "")] || [];
}

export function resolveDriverPortrait(driverId, activeYear, fallback = "") {
  const timeline = driverPortraitTimeline(driverId);
  const safeFallback = safePortraitFallback(fallback);
  if (!timeline.length) return safeFallback;

  const year = Number(activeYear);
  if (!Number.isFinite(year)) return timeline[timeline.length - 1]?.path || safeFallback;

  let selected = null;
  for (const portrait of timeline) {
    if (Number(portrait.year) <= year) selected = portrait;
    else break;
  }

  return selected?.path || safeFallback;
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
