// src/domain/driverPortraits.js
// Historical driver portrait registry.
//
// Portraits are keyed by stable driver_id, never by display name. Paths are
// explicit so different image formats (.webp, .png, .jpg, .jpeg) can coexist.
// When multiple eras are available, the latest portrait not newer than the
// active season is selected.

const DRIVER_PORTRAITS = Object.freeze({
  d_0001: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0001.webp" }]),
  d_0002: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0002.webp" }]),
  d_0003: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0003.webp" }]),
  d_0004: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0004.webp" }]),
  d_0005: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0005.webp" }]),
  d_0006: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0006.webp" }]),
  d_0007: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0007.webp" }]),
  d_0008: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0008.webp" }]),
  d_0009: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0009.webp" }]),
  d_0010: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0010.webp" }]),
  d_0011: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0011.webp" }]),
  d_0012: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0012.webp" }]),
  d_0013: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0013.webp" }]),
  d_0014: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0014.webp" }]),
  d_0015: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0015.webp" }]),
  d_0016: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0016.webp" }]),
  d_0017: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0017.webp" }]),
  d_0018: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0018.webp" }]),
  d_0019: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0019.webp" }]),
  d_0020: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0020.webp" }]),
  d_0110: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0110.webp" }]),
  d_0205: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0205.webp" }]),
  d_0213: Object.freeze([{ year: 1980, path: "/portraits/drivers/1980/d_0213.webp" }]),
});

export function driverPortraitTimeline(driverId) {
  return DRIVER_PORTRAITS[String(driverId || "")] || [];
}

export function resolveDriverPortrait(driverId, activeYear, fallback = "") {
  const timeline = driverPortraitTimeline(driverId);
  if (!timeline.length) return fallback || "";

  const year = Number(activeYear);
  if (!Number.isFinite(year)) return timeline[timeline.length - 1]?.path || fallback || "";

  let selected = null;
  for (const portrait of timeline) {
    if (Number(portrait.year) <= year) selected = portrait;
    else break;
  }

  return selected?.path || fallback || "";
}

export { DRIVER_PORTRAITS };
