// src/data/seasonPackLoader.js
import { hydrateDriverPortraitRows } from "../domain/driverPortraits.js";
import { materializeSeasonPack } from "./seasonPackMaterializer.js";
export class SeasonPackError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "SeasonPackError";
    this.details = details;
  }
}

export const SEASON_PACK_SCHEMA_VERSION=2;

export function validateLoadedSeasonPack(pack, expectedYear) {
  if (!pack || pack.format !== "f1ml-season-pack") {
    throw new SeasonPackError("Invalid Season Pack format.");
  }
  const schemaVersion=Number(pack.schemaVersion||0);
  if(schemaVersion<SEASON_PACK_SCHEMA_VERSION){
    throw new SeasonPackError(
      `Season Pack schema ${schemaVersion||"legacy"} is stale; current runtime requires ${SEASON_PACK_SCHEMA_VERSION}.`
    );
  }
  const year = Number(pack.year);
  if (!Number.isInteger(year)) {
    throw new SeasonPackError("Season Pack has no valid year.");
  }
  if (expectedYear != null && Number(expectedYear) !== year) {
    throw new SeasonPackError(`Season Pack year mismatch: expected ${expectedYear}, received ${year}.`);
  }
  if (!pack.validation?.ok) {
    throw new SeasonPackError(`Season ${year} is not structurally ready.`, pack.validation);
  }
  return pack;
}



export function seasonPackGlobalDataFromDatabaseState(state={}) {
  return {
    drivers:state.dbDrivers||[],
    calendar:state.dbCalendar||[],
    teams:state.dbTeams||[],
    driverRatings:state.dbDriverRatings||[],
    historicalRatingSnapshots:state.dbHistoricalRatingSnapshots||[],
    driverRatingProfiles:state.dbDriverRatingProfiles||[],
    driverYearStatus:state.dbDriverYearStatus||[],
    driverOpeningState:state.dbDriverOpeningState||[],
    driverDevelopmentHistory:state.dbDriverDevelopmentHistory||[],
    driverAvailabilityHistory:state.dbDriverAvailabilityHistory||[],
    driverTeamHistory:state.dbDriverTeamHistory||[],
    teamEngineHistory:state.dbTeamEngineHistory||[],
    carCompetitiveness:state.dbCarCompetitiveness||[],
    driverCareer:state.dbDriverCareer||[],
    series:state.dbSeries||[],
    seriesRules:state.dbSeriesRules||[],
    driverHistory:state.dbDriverHistory||[],
    historicalChampionships:state.dbHistoricalChampionships||{drivers:[],constructors:[]},
    teamLineageHistory:state.dbTeamLineageHistory||[],
    staffRatings:state.dbStaffRatings||[],
    staffCore:state.dbStaffCore||[],
    teamBrands:state.dbTeamBrands||[],
    teamEngines:state.dbTeamEngines||[],
    contracts:state.dbContracts||[],
    sponsorsContracts:state.dbSponsorsContracts||[],
    rules:state.dbRules||[],
    qualifyingRules:state.dbQualifyingRules||[],
    qualifyingRuleOverrides:state.dbQualifyingRuleOverrides||[],
    eraSafety:state.dbEraSafety||[],
    accidentModel:state.dbAccidentModel||[],
    facilities:state.dbFacilities||[],
    carStats:state.dbCarStats||[],
    staffContracts:state.dbStaffContracts||[],
    tyres:state.dbTyres||[],
    pointsSystems:state.dbPointsSystems||[],
    penaltiesRules:state.dbPenaltiesRules||[],
    financialRules:state.dbFinancialRules||[],
    agendaBlocks:state.dbAgendaBlocks||[],
    contractRules:state.dbContractRules||[],
    youthIntakeRules:state.dbYouthIntakeRules||[],
    scoutingZones:state.dbScoutingZones||[],
    trackLayoutByYear:state.dbTrackLayoutByYear||[],
    teamSeasons:state.dbTeamSeasons||[],
    coreTracks:state.dbCoreTracks||[],
  };
}

export function materializeSeasonPackFromDatabaseState(state,yearInput) {
  const year=Number(yearInput);
  if(!Number.isInteger(year))throw new SeasonPackError("Season year must be an integer.");
  const pack=materializeSeasonPack(seasonPackGlobalDataFromDatabaseState(state),year);
  return validateLoadedSeasonPack(pack,year);
}

export async function fetchSeasonIndex() {
  const res = await fetch("/data/seasons/index.json", { cache: "no-store" });
  if (!res.ok) throw new SeasonPackError(`Season index HTTP ${res.status}.`);
  const payload = await res.json();
  if (payload?.format !== "f1ml-season-index" || !Array.isArray(payload?.years)) {
    throw new SeasonPackError("Invalid Season Pack index.");
  }
  return payload;
}

export async function fetchSeasonPack(yearInput) {
  const year = Number(yearInput);
  if (!Number.isInteger(year)) throw new SeasonPackError("Season year must be an integer.");
  const res = await fetch(`/data/seasons/${year}/season.json`, { cache: "no-store" });
  if (!res.ok) throw new SeasonPackError(`No generated Season Pack for ${year} (HTTP ${res.status}).`);
  return validateLoadedSeasonPack(await res.json(), year);
}

export function seasonPackStatePatch(pack) {
  validateLoadedSeasonPack(pack);
  const s = pack.state || {};
  return {
    activeYear: Number(pack.year),
    currentDateISO: `${pack.year}-01-01`,
    currentRound: 0,
    calendar: Array.isArray(s.calendar) ? s.calendar : [],
    teams: Array.isArray(s.teams) ? s.teams : [],
    drivers: hydrateDriverPortraitRows(Array.isArray(s.drivers) ? s.drivers : [], Number(pack.year)),
    driverRatings: Array.isArray(s.driverRatings) ? s.driverRatings : [],
    driverCareer: Array.isArray(s.driverCareer) ? s.driverCareer : [],
    driverHistory: Array.isArray(s.driverHistory) ? s.driverHistory : [],
    driverWorldEntry: Array.isArray(s.driverWorldEntry) ? s.driverWorldEntry : [],
    driverFeederPlacement: Array.isArray(s.driverFeederPlacement) ? s.driverFeederPlacement : [],
    driverOpeningState: Array.isArray(s.driverOpeningState) ? s.driverOpeningState : [],
    contracts: Array.isArray(s.contracts) ? s.contracts : [],
    staffCore: Array.isArray(s.staffCore) ? s.staffCore : [],
    staffRatings: Array.isArray(s.staffRatings) ? s.staffRatings : [],
    staffContracts: Array.isArray(s.staffContracts) ? s.staffContracts : [],
    teamBrands: Array.isArray(s.teamBrands) ? s.teamBrands : [],
    teamHistoricalStrength: Array.isArray(s.teamHistoricalStrength) ? s.teamHistoricalStrength : [],
    teamEngines: Array.isArray(s.teamEngines) ? s.teamEngines : [],
    facilities: Array.isArray(s.facilities) ? s.facilities : [],
    carStats: Array.isArray(s.carStats) ? s.carStats : [],
    sponsorsContracts: Array.isArray(s.sponsorsContracts) ? s.sponsorsContracts : [],
    rules: Array.isArray(s.rules) ? s.rules : [],
    qualifyingRules: s.qualifyingRules && typeof s.qualifyingRules === "object" ? s.qualifyingRules : null,
    eraSafety: Array.isArray(s.eraSafety) ? s.eraSafety : [],
    accidentModel: Array.isArray(s.accidentModel) ? s.accidentModel : [],
    tyres: Array.isArray(s.tyres) ? s.tyres : [],
    pointsSystem: s.pointsSystem || null,
    penaltiesRules: Array.isArray(s.penaltiesRules) ? s.penaltiesRules : [],
    financialRules: Array.isArray(s.financialRules) ? s.financialRules : [],
    agendaBlocks: Array.isArray(s.agendaBlocks) ? s.agendaBlocks : [],
    coreTracks: Array.isArray(s.coreTracks) ? s.coreTracks : [],
    trackLayoutByYear: Array.isArray(s.trackLayoutByYear) ? s.trackLayoutByYear : [],
    seasonPackMeta: {
      format: pack.format,
      schemaVersion: pack.schemaVersion,
      year: Number(pack.year),
      ratingModel: pack.ratingModel || "legacy",
      validation: pack.validation,
    },
  };
}
