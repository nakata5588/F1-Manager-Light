// src/core/random.js
function hashSeed(input) {
  let h = 2166136261 >>> 0;
  for (const char of String(input ?? "")) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;

  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError("int(min, max) expects integer bounds with max >= min.");
      }
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick(values) {
      if (!Array.isArray(values) || values.length === 0) return undefined;
      return values[Math.floor(next() * values.length)];
    },
    chance(probability) {
      const p = Math.max(0, Math.min(1, Number(probability) || 0));
      return next() < p;
    },
  };
}

export function getSaveSeed(gameState) {
  const seed = gameState?.saveMeta?.seed;
  if (seed == null || seed === "") return "f1ml-unseeded-legacy";
  return String(seed);
}

export function rngFor(gameState, entropyKey) {
  return createRng(`${getSaveSeed(gameState)}::${String(entropyKey ?? "default")}`);
}

export function gameplayRngFor(gameState, scope, entropyKey = "default") {
  const domain = String(scope ?? "").trim();
  if (!domain) throw new TypeError("gameplayRngFor requires a non-empty scope.");
  return rngFor(gameState, `gameplay:${domain}:${String(entropyKey ?? "default")}`);
}

export { hashSeed };
