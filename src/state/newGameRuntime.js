import { synchronizeDriverRelationships } from "../domain/driverRelationships.js";
import { hydrateDriverPortraitRows } from "../domain/driverPortraits.js";

// src/state/newGameRuntime.js
// New Game isolation boundary.
// Historical/database seed data may cross into a fresh career. Simulated Save
// World state must be recreated explicitly and never inherited from the
// previously loaded career.

export const FRESH_CAREER_STATIC_KEYS=Object.freeze([
  // Global database / catalogues.
  "dbCalendar","dbDrivers","dbTeams","dbDriverRatings","dbDriverHistory",
  "dbDriverOpeningState","dbStaffRatings","dbStaffCore","dbDriverCareer",
  "dbAchievements","dbTeamBrands","dbTeamEngines","dbContracts",
  "dbSponsorsContracts","dbRules","dbEraSafety","dbAccidentModel",
  "dbFacilities","dbCarStats","dbCarParts","dbStaffContracts","dbTyres",
  "dbPointsSystems","dbQualifyingRules","dbQualifyingRuleOverrides",
  "dbPenaltiesRules","dbFinancialRules","dbBoardGoals","dbAgendaBlocks",
  "dbLogosIndex","dbAIDifficulty","dbContractRules","dbYouthIntakeRules",
  "dbScoutingZones","dbTrackLayoutByYear","dbTeamSeasons","dbCoreTracks",
  "dbWeatherProfiles","dbWeatherStates","dbPitcrewRoster",

  // Dataset discovery / selected Season Pack metadata.
  "yearsAvailable","seasonPackIndex","seasonPackMeta",

  // Historical starting conditions materialized for the selected season.
  "calendar","teams","drivers","driverRatings","driverCareer","driverHistory",
  "driverOpeningState","staffRatings","staffCore","staffContracts","teamBrands",
  "teamEngines","contracts","sponsorsContracts","rules","qualifyingRules",
  "eraSafety","accidentModel","facilities","carStats","tyres","pointsSystem",
  "penaltiesRules","financialRules","agendaBlocks","coreTracks",
  "trackLayoutByYear",
]);

function copyStaticWorld(source){
  const out={};
  for(const key of FRESH_CAREER_STATIC_KEYS){
    if(Object.prototype.hasOwnProperty.call(source||{},key))out[key]=source[key];
  }
  return out;
}

export function freshCareerRuntimeState({ initialDriverConditions = {} } = {}) {
  return {
    results: [],
    lastRace: null,
    resultsHistory: [],
    historySeasons: [],

    standings: { drivers: [], teams: [] },
    inbox: [],
    eventsQueue: [],

    financeFlags: {},
    financeLog: [],
    finances: null,
    board: null,
    commercialScore: null,
    manager: null,

    rdProjectsActive: [],
    meta: {},
    ops: {},
    selectedDrivers: [],
    _seasonFinishedAt: null,
    showSeasonSummary: false,

    driverAttrLog: {},
    driverMentalStateLog: {},
    driverReputationLog: {},
    driverRelationships: { version: 2, relations: {}, log: [] },
    driverRivalries: { version: 1, pairs: {}, log: [] },
    driverStaffAssignments: { version: 1, assignments: {}, history: [] },
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

    // Technical Save World state.
    development: { projects: [], parts: [], partUnits: [], manufacturing: [], research: [], technologyProjects: [], aeroTestingUsage: [], technicalKnowledge: null, nextSeasonCar: null },
    technicalUnlocks: {},
    technologyDiscoverySeen: {},
    garage: { cars: [], serviceJobs: [], baseComponentStock: {}, reserveCarBuilt: false },
    componentServiceLog: [],
    componentWearLog: [],
    aiTechnicalWorld: { version: 1, teams: {} },
    regulationGovernance: { version: 1, votes: [], approved_changes: [] },
    hq: { facilityLevels: {}, upgrades: [] },

    academy: { drivers: [] },
    scouting: { assignments: [], shortlist: [] },

    // Team operational state is simulated runtime state.
    teamOperationalState: {},
    teamMoraleLog: {},
    teamReputationState: {},
    teamReputationLog: {},

    raceEntryState: null,
    raceWeekendState: null,
  };
}

export function buildFreshCareerState(source,runtimePatch={}){
  const fresh={
    ...copyStaticWorld(source||{}),
    ...freshCareerRuntimeState({
      initialDriverConditions:runtimePatch?.driverAttributes||{},
    }),
    ...runtimePatch,
  };
  const activeYear=Number(fresh?.activeYear??source?.activeYear??fresh?.seasonPackMeta?.year);
  const withPortraits={
    ...fresh,
    drivers:hydrateDriverPortraitRows(fresh?.drivers,activeYear),
    dbDrivers:hydrateDriverPortraitRows(fresh?.dbDrivers,activeYear),
  };
  return synchronizeDriverRelationships(withPortraits,{source:"career_start_neutral"});
}
