// src/game/utils/rules.js
let cache;
export async function loadRules() {
  if (!cache) {
    const res = await fetch("/data/rules.json");
    cache = await res.json(); // esperado: { "1980": {...}, "1981": {...}, "2014": {...}, "default": {...} }
  }
  return cache;
}
export async function getRulesForYear(year) {
  const all = await loadRules();
  return all[String(year)] || all.default || {};
}
