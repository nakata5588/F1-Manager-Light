// src/domain/driverPortraits.js
// Driver portrait compatibility wrapper around the shared historical asset system.
import {
  historicalAssetCandidatesFromSet,
  historicalAssetManifest,
  historicalAssetSet,
  historicalAssetTimeline,
  resolveHistoricalAsset,
} from "./historicalAssets.js";

const MANAGED_PORTRAIT_PREFIXES=Object.freeze([
  "/portraits/drivers/",
  "/assets/drivers/",
]);

function driverIdOf(driver) {
  return String(driver?.driver_id ?? driver?.id ?? driver?.driverId ?? driver?.code ?? "");
}

function driverAliases(driver){
  return [
    driverIdOf(driver),
    driver?.display_name,
    driver?.driver_name,
    driver?.name,
    [driver?.first_name,driver?.last_name].filter(Boolean).join(" "),
  ];
}

function safePortraitFallback(fallback) {
  const value=String(fallback||"");
  return MANAGED_PORTRAIT_PREFIXES.some((prefix)=>value.startsWith(prefix))?"":value;
}

export function driverPortraitSet(driverId,aliases=[]) {
  return historicalAssetSet("drivers",[driverId,...(Array.isArray(aliases)?aliases:[aliases])]);
}

export function driverPortraitTimeline(driverId,aliases=[]) {
  return historicalAssetTimeline("drivers",[driverId,...(Array.isArray(aliases)?aliases:[aliases])]);
}

export function resolvePortraitSet(entry,activeYear,fallback="") {
  return historicalAssetCandidatesFromSet(
    entry,
    activeYear,
    safePortraitFallback(fallback)
  )[0]||"";
}

export function resolveDriverPortrait(driverId,activeYear,fallback="",aliases=[]) {
  return resolveHistoricalAsset(
    "drivers",
    [driverId,...(Array.isArray(aliases)?aliases:[aliases])],
    activeYear,
    safePortraitFallback(fallback)
  );
}

export function hydrateDriverPortraitRows(rows, activeYear) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((driver) => {
    if (!driver || typeof driver !== "object") return driver;
    const aliases=driverAliases(driver);
    const hadPortraitField =
      Object.prototype.hasOwnProperty.call(driver, "portrait_path") ||
      Object.prototype.hasOwnProperty.call(driver, "portrait");
    const portraitPath = resolveDriverPortrait(
      aliases[0],
      activeYear,
      driver.portrait_path ?? driver.portrait ?? "",
      aliases.slice(1)
    );

    if (!portraitPath && !hadPortraitField) return driver;

    return {
      ...driver,
      portrait_path: portraitPath,
    };
  });
}

// Backwards-compatible export for any developer tooling that still expects the
// old registry symbol. Keys are normalized internally by the generated manifest.
export const DRIVER_PORTRAITS=historicalAssetManifest().drivers;
