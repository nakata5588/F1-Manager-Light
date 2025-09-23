// src/engine/MarketEngine.js
export function applyMarketTick(gs) {
  const next = { ...gs };
  const devBoost = gs?.settings?.developer?.showDevTools ? 0.5 : 0; // 50% em DEV
  const chance = 0.03 + devBoost;

  if (Math.random() < chance && (gs.drivers || []).length >= 2 && (gs.teams || []).length >= 1) {
    const a = gs.drivers[Math.floor(Math.random() * gs.drivers.length)];
    const b = gs.teams[Math.floor(Math.random() * gs.teams.length)];
    next.inbox = [
      {
        id: `rumor_${Date.now()}`,
        date: gs.currentDateISO,
        from: "Media",
        tag: "Media",
        subject: "Paddock Rumor",
        body: `${a.display_name || a.name} poderá estar na mira da ${b.short_name || b.team_name || b.name}.`,
        actions: [{ label: "Abrir Mercado", route: "/market" }],
      },
      ...(gs.inbox || []),
    ];
  }
  return next;
}
