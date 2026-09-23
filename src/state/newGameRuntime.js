// src/state/newGameRuntime.js
// Runtime-only Save World state that must never leak from one career into a New Game.
// Historical/database seed data lives outside this patch and is preserved by the caller.

export function freshCareerRuntimeState({ initialDriverConditions = {} } = {}) {
  return {
    results: [],
    lastRace: null,
    financeFlags: {},
    rdProjectsActive: [],
    meta: {},
    ops: {},
    selectedDrivers: [],
    _seasonFinishedAt: null,
    showSeasonSummary: false,

    eventsQueue: [],
    driverAttrLog: {},
    driverAttributes: initialDriverConditions,
    driverAvailability: {},
    medicalHistory: [],
    temporaryDriverAssignments: [],
    driverNegotiations: [],

    // Driver D4/D5 runtime state. These are Save World outputs, never historical seed.
    driverPerformanceLog: {},
    driverForm: {},
    driverDevelopmentFocus: {},
    driverDevelopmentFocusMeta: {},
    driverDevelopmentTraining: {},
    driverLifecycle: {},
    driverLifecycleLog: {},
    driverPotentialLog: {},
    driverAbilityLog: {},
    _lastDriverProgressionMonth: null,

    // Team operational state is also simulated runtime state.
    teamOperationalState: {},
    teamMoraleLog: {},

    raceEntryState: null,
    raceWeekendState: null,
  };
}
