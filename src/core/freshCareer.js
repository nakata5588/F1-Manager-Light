// src/core/freshCareer.js
// New Game isolation boundary.
// Only historical/database material and current season seed data may cross from
// the currently loaded gameState into a brand-new career. All simulated/runtime
// state must be recreated explicitly by startNewGame.

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

  // Dataset discovery / selected season metadata.
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

export function freshCareerRuntimeDefaults(){
  return {
    results:[],
    lastRace:null,
    resultsHistory:[],
    historySeasons:[],

    standings:{drivers:[],teams:[]},
    inbox:[],
    eventsQueue:[],

    driverAttrLog:{},
    driverAttributes:{},
    driverAvailability:{},
    medicalHistory:[],
    temporaryDriverAssignments:[],
    driverNegotiations:[],
    driverPerformanceLog:{},
    driverForm:{},

    raceEntryState:null,
    raceWeekendState:null,

    financeFlags:{},
    financeLog:[],
    finances:null,
    board:null,
    commercialScore:null,

    academy:{drivers:[]},
    scouting:{assignments:[],shortlist:[]},

    development:{projects:[],parts:[],partUnits:[],manufacturing:[],research:[]},
    garage:{cars:[],serviceJobs:[],baseComponentStock:{}},
    componentServiceLog:[],
    rdProjectsActive:[],

    aiTechnicalWorld:{version:1,teams:{}},
    teamOperationalState:{},
    teamMoraleLog:{},

    hq:{facilityLevels:{},upgrades:[]},

    selectedDrivers:[],
    meta:{},
    ops:{},

    _seasonFinishedAt:null,
    showSeasonSummary:false,
  };
}

export function buildFreshCareerState(source,runtimePatch={}){
  return {
    ...copyStaticWorld(source||{}),
    ...freshCareerRuntimeDefaults(),
    ...runtimePatch,
  };
}
