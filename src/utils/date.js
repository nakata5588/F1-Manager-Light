export function toDate(iso) {
  if (!iso) return new Date(NaN);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function daysBetween(fromISO, toISO) {
  const ms = toDate(toISO) - toDate(fromISO);
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export function fmtISO(iso) {
  const dt = toDate(iso);
  if (Number.isNaN(dt.getTime())) return iso ?? "";
  return dt.toISOString().slice(0, 10);
}

export function ageOn(currentISO, birthISO) {
  const c = toDate(currentISO);
  const b = toDate(birthISO);
  if (Number.isNaN(c) || Number.isNaN(b)) return null;
  let age = c.getUTCFullYear() - b.getUTCFullYear();
  const m = c.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && c.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
