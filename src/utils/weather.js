// src/utils/weather.js

export function pickWeighted(weights) {
  const entries = Object.entries(weights || {});
  if (!entries.length) return null;
  const sum = entries.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * sum;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

export function resolveWeatherProfile({ trackId, month, country }, profiles) {
  if (!profiles) return null;
  const m = Number(month);

  const byTrack = (profiles.track_overrides || []).find(p => p.track_id === trackId && Number(p.month) === m);
  if (byTrack?.weights) return byTrack.weights;

  const byCountry = (profiles.country_month || []).find(p => p.country === country && Number(p.month) === m);
  if (byCountry?.weights) return byCountry.weights;

  const zone = (profiles.track_to_zone || []).find(z => z.track_id === trackId)?.zone;
  if (!zone) return null;

  const zoneCfg = (profiles.climate_zone_defaults || []).find(z => z.zone === zone);
  return zoneCfg?.weights_by_month?.[String(m)] || null;
}

export function pickInitialWeather(ctx, profiles) {
  const weights = resolveWeatherProfile(ctx, profiles);
  return pickWeighted(weights) || "SUNNY";
}

export function toStatesDict(statesArray) {
  const dict = {};
  for (const s of statesArray || []) dict[s.id] = s;
  return dict;
}

export function getWeatherRiskModifiers(stateId, statesDict) {
  const s = statesDict?.[stateId];
  return {
    crash_risk_ppm: s?.crash_risk_ppm ?? 1.0,
    dnf_risk_ppm: s?.dnf_risk_ppm ?? 1.0,
    safety_car_chance_pct: s?.safety_car_chance_pct ?? 0,
    red_flag_chance_pct: s?.red_flag_chance_pct ?? 0
  };
}
