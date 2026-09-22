// src/domain/managementEvents.js
// RW3.3 — unified management timeline.
// The Save World/GameState remains the source of truth. Historical data is not read here.

const DAY_MS = 86_400_000;

function asISO(value) {
  if (!value) return null;
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function shiftISO(iso, days) {
  const value = asISO(iso);
  if (!value) return null;
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function firstDate(row, keys) {
  for (const key of keys) {
    const value = asISO(row?.[key]);
    if (value) return value;
  }
  return null;
}

function eventId(prefix, ...parts) {
  return [prefix, ...parts].filter((x) => x !== null && x !== undefined && x !== "").join("_");
}

function driverNameFromContract(contract, driverById) {
  const id = String(contract?.driver_id ?? contract?.person_id ?? contract?.driverId ?? "");
  const d = driverById.get(id);
  return (
    contract?.driver_name ||
    d?.display_name ||
    d?.name ||
    [d?.first_name, d?.last_name].filter(Boolean).join(" ") ||
    id ||
    "Driver"
  );
}

function normalizeSavedEvents(gs) {
  const raw = [
    ...(Array.isArray(gs?.events) ? gs.events : []),
    ...(Array.isArray(gs?.agenda) ? gs.agenda : []),
  ];
  return raw.map((e, index) => ({
    id: String(e?.id ?? eventId("SAVE", index, e?.title ?? e?.name)),
    date: asISO(e?.date ?? e?.dateISO ?? e?.when),
    type: String(e?.type ?? e?.category ?? "OTHER").toUpperCase(),
    title: e?.title ?? e?.name ?? "Event",
    subtitle: e?.subtitle ?? e?.description ?? "",
    priority: e?.priority ?? "normal",
    route: e?.route ?? e?.href ?? null,
    source: "save",
    meta: e,
  })).filter((e) => e.date);
}

function raceWeekendEvents(gs) {
  const rows = Array.isArray(gs?.calendar) ? gs.calendar : [];
  const events = [];

  for (const gp of rows) {
    const raceDate = firstDate(gp, ["race_date", "date", "dateISO", "raceDate"]);
    if (!raceDate) continue;
    const round = gp?.round ?? gp?.gp_id ?? gp?.id ?? gp?.track_id ?? gp?.gp_name ?? raceDate;
    const title = gp?.gp_name ?? gp?.name ?? "Grand Prix";
    const subtitle = gp?.country ?? gp?.Country ?? gp?.circuit_name ?? "";
    const weekendStart = firstDate(gp, ["weekend_start_date", "start_date"]);

    // If the database/save supplies a weekend start, use it. Otherwise the UI uses
    // a presentation-only Fri/Sat/Sun convention; simulation rules remain era-aware.
    const practiceDate = weekendStart || shiftISO(raceDate, -2);
    const qualifyingDate = firstDate(gp, ["qualifying_date", "qualy_date"]) || shiftISO(raceDate, -1);

    events.push(
      {
        id: eventId("PRACTICE", round, raceDate),
        date: practiceDate,
        type: "PRACTICE",
        title: `Practice — ${title}`,
        subtitle,
        priority: "normal",
        route: "/RaceWeekend",
        source: "calendar",
        meta: { gp, session: "practice" },
      },
      {
        id: eventId("QUALIFYING", round, raceDate),
        date: qualifyingDate,
        type: "QUALIFYING",
        title: `Qualifying — ${title}`,
        subtitle,
        priority: "normal",
        route: "/RaceWeekend",
        source: "calendar",
        meta: { gp, session: "qualifying" },
      },
      {
        id: eventId("RACE", round, raceDate),
        date: raceDate,
        type: "GP",
        title,
        subtitle,
        priority: "high",
        route: "/RaceWeekend",
        source: "calendar",
        meta: { gp, session: "race" },
      },
    );
  }
  return events;
}

function contractEvents(gs) {
  const contracts = Array.isArray(gs?.contracts)
    ? gs.contracts
    : Array.isArray(gs?.driverContracts)
      ? gs.driverContracts
      : [];
  const drivers = Array.isArray(gs?.drivers) ? gs.drivers : (gs?.dbDrivers || []);
  const driverById = new Map(drivers.map((d) => [
    String(d?.driver_id ?? d?.id ?? d?.driverId ?? ""),
    d,
  ]));
  return contracts.map((contract, index) => {
    const date = firstDate(contract, [
      "end_date",
      "contract_end",
      "expiry_date",
      "expires_on",
      "date_to",
      "to",
    ]);
    if (!date) return null;
    const name = driverNameFromContract(contract, driverById);
    return {
      id: eventId("CONTRACT", contract?.contract_id ?? contract?.id ?? index, date),
      date,
      type: "CONTRACT",
      title: `Contract expires — ${name}`,
      subtitle: contract?.role ?? contract?.seat ?? "",
      priority: "high",
      route: "/MyDrivers",
      source: "contracts",
      meta: contract,
    };
  }).filter(Boolean);
}

function developmentEvents(gs) {
  const dev = gs?.development || {};
  const raw = [
    ...(Array.isArray(dev?.projects) ? dev.projects : []),
    ...(Array.isArray(dev?.partsInProgress) ? dev.partsInProgress : []),
    ...(Array.isArray(dev?.inProgress) ? dev.inProgress : []),
  ];
  return raw.map((project, index) => {
    const date = firstDate(project, [
      "completion_date",
      "complete_date",
      "due_date",
      "eta_date",
      "ready_date",
      "finish_date",
    ]);
    if (!date) return null;
    return {
      id: eventId("DEV", project?.id ?? index, date),
      date,
      type: "DEV",
      title: `Development complete — ${project?.name ?? project?.part ?? project?.slot ?? "Project"}`,
      subtitle: project?.status ?? "",
      priority: "normal",
      route: "/Development",
      source: "development",
      meta: project,
    };
  }).filter(Boolean);
}

function facilityEvents(gs) {
  const raw = [
    ...(Array.isArray(gs?.hq?.projects) ? gs.hq.projects : []),
    ...(Array.isArray(gs?.hq?.upgrades) ? gs.hq.upgrades : []),
    ...(Array.isArray(gs?.facilitiesInProgress) ? gs.facilitiesInProgress : []),
  ];
  return raw.map((project, index) => {
    const date = firstDate(project, [
      "completion_date",
      "complete_date",
      "due_date",
      "eta_date",
      "ready_date",
      "finish_date",
    ]);
    if (!date) return null;
    return {
      id: eventId("HQ", project?.id ?? index, date),
      date,
      type: "HQ",
      title: `Facility complete — ${project?.name ?? project?.facility ?? "Upgrade"}`,
      subtitle: project?.status ?? "",
      priority: "normal",
      route: "/HQ",
      source: "hq",
      meta: project,
    };
  }).filter(Boolean);
}

function healthEvents(gs) {
  const raw = [
    ...(Array.isArray(gs?.injuries) ? gs.injuries : []),
    ...(Array.isArray(gs?.driverHealth?.injuries) ? gs.driverHealth.injuries : []),
  ];
  const drivers = Array.isArray(gs?.drivers) ? gs.drivers : (gs?.dbDrivers || []);
  const byId = new Map(drivers.map((d) => [
    String(d?.driver_id ?? d?.id ?? ""),
    d,
  ]));
  return raw.map((injury, index) => {
    const date = firstDate(injury, [
      "return_date",
      "expected_return_date",
      "recovery_date",
      "end_date",
    ]);
    if (!date) return null;
    const did = String(injury?.driver_id ?? injury?.driverId ?? "");
    const d = byId.get(did);
    const name = injury?.driver_name ?? d?.display_name ?? d?.name ?? did ?? "Driver";
    return {
      id: eventId("MEDICAL", did || index, date),
      date,
      type: "MEDICAL",
      title: `Expected return — ${name}`,
      subtitle: injury?.label ?? injury?.type ?? injury?.injury ?? "",
      priority: "high",
      route: "/MyDrivers",
      source: "health",
      meta: injury,
    };
  }).filter(Boolean);
}

function deadlineEvents(gs) {
  const inbox = Array.isArray(gs?.inbox) ? gs.inbox : [];
  return inbox.map((message, index) => {
    const date = firstDate(message, ["due_date", "deadline", "respond_by"]);
    if (!date) return null;
    return {
      id: eventId("DEADLINE", message?.id ?? index, date),
      date,
      type: "DEADLINE",
      title: message?.subject ?? message?.title ?? "Decision deadline",
      subtitle: message?.sender ?? message?.category ?? "",
      priority: message?.priority ?? "high",
      route: "/Inbox",
      source: "inbox",
      meta: message,
    };
  }).filter(Boolean);
}

export function buildManagementEvents(gs) {
  if (!gs || typeof gs !== "object") return [];

  const all = [
    ...normalizeSavedEvents(gs),
    ...raceWeekendEvents(gs),
    ...contractEvents(gs),
    ...developmentEvents(gs),
    ...facilityEvents(gs),
    ...healthEvents(gs),
    ...deadlineEvents(gs),
  ];

  const deduped = new Map();
  for (const item of all) {
    if (!item?.date) continue;
    const key = String(item.id || eventId(item.type, item.date, item.title));
    if (!deduped.has(key)) deduped.set(key, item);
  }

  return [...deduped.values()].sort((a, b) => {
    const dateCmp = String(a.date).localeCompare(String(b.date));
    if (dateCmp) return dateCmp;
    const p = { critical: 0, high: 1, normal: 2, low: 3 };
    const pa = p[String(a.priority || "normal").toLowerCase()] ?? 2;
    const pb = p[String(b.priority || "normal").toLowerCase()] ?? 2;
    if (pa !== pb) return pa - pb;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function upcomingManagementEvents(gs, { fromDate = null, limit = 8 } = {}) {
  const from = asISO(fromDate ?? gs?.currentDateISO) ?? "0000-01-01";
  return buildManagementEvents(gs)
    .filter((event) => event.date >= from)
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function daysBetweenISO(a, b) {
  const aa = asISO(a);
  const bb = asISO(b);
  if (!aa || !bb) return null;
  const da = new Date(`${aa}T12:00:00Z`);
  const db = new Date(`${bb}T12:00:00Z`);
  return Math.round((db - da) / DAY_MS);
}
