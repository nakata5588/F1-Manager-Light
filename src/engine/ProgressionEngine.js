// src/engine/ProgressionEngine.js
function clamp(n, a=0, b=100) { return Math.max(a, Math.min(b, n)); }
function today(gs){ return (gs.currentDateISO || "").slice(0,10); }

export function applyProgressionTick(gs) {
  const next = { ...gs };
  const dateISO = today(gs);
  const dict = { ...(gs.driverAttributes || {}) };

  for (const d of (gs.drivers || [])) {
    const id = String(d.driver_id);
    const curr = dict[id] || { confidence: 50, fatigue: 20, morale: 50, preparation: 40 };

    // se não queres ainda mexer, comenta as 2 linhas abaixo
    const weekend = new Date(dateISO).getUTCDay() % 6 === 0;
    const drift = (Math.random() * 2 - 1);
    const rest = weekend ? 4 : 1;

    dict[id] = {
      ...curr,
      fatigue: clamp(curr.fatigue - rest),
      confidence: clamp(curr.confidence + drift),
      // podes ir ligando morale/preparation via eventos/treinos mais tarde
    };
  }
  next.driverAttributes = dict;
  return next;
}
