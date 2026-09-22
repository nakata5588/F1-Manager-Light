import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManagementEvents,
  upcomingManagementEvents,
  daysBetweenISO,
} from "../src/domain/managementEvents.js";

test("management timeline derives race weekend sessions and preserves saved events", () => {
  const gs = {
    currentDateISO: "1980-03-01",
    calendar: [{
      year: 1980,
      round: 1,
      gp_name: "Argentine Grand Prix",
      race_date: "1980-03-09",
    }],
    events: [{ id: "board-1", date: "1980-03-03", type: "BOARD", title: "Board review" }],
  };
  const events = buildManagementEvents(gs);
  assert.equal(events.find((x) => x.type === "PRACTICE")?.date, "1980-03-07");
  assert.equal(events.find((x) => x.type === "QUALIFYING")?.date, "1980-03-08");
  assert.equal(events.find((x) => x.type === "GP")?.date, "1980-03-09");
  assert.ok(events.some((x) => x.title === "Board review"));
});

test("timeline surfaces contracts, development and inbox deadlines from Save World", () => {
  const gs = {
    currentDateISO: "1980-06-01",
    drivers: [{ driver_id: "D1", display_name: "Test Driver" }],
    contracts: [{ id: "C1", driver_id: "D1", end_date: "1980-06-20", role: "main" }],
    development: { partsInProgress: [{ id: "P1", name: "Rear Wing", completion_date: "1980-06-10" }] },
    inbox: [{ id: "M1", title: "Board response", deadline: "1980-06-05", priority: "high" }],
  };
  const upcoming = upcomingManagementEvents(gs, { limit: 10 });
  assert.ok(upcoming.some((x) => x.type === "CONTRACT" && x.title.includes("Test Driver")));
  assert.ok(upcoming.some((x) => x.type === "DEV" && x.title.includes("Rear Wing")));
  assert.ok(upcoming.some((x) => x.type === "DEADLINE" && x.title === "Board response"));
  assert.deepEqual(upcoming.map((x) => x.date), [...upcoming.map((x) => x.date)].sort());
});

test("daysBetweenISO is stable across DST because it uses UTC noon", () => {
  assert.equal(daysBetweenISO("2026-03-28", "2026-03-30"), 2);
});
