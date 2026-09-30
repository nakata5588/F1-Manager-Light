// src/race2/adapters/GameStateInputAdapter.js
import { getSaveSeed } from "../../core/random.js";
import { teamCarPerformance } from "../../domain/carPerformance.js";
import { conditionModifierBreakdown, raceDriverScore } from "../../domain/driverPerformance.js";
import { driverDerivedRating, driverMistakePropensity } from "../../domain/driverDerivedRatings.js";
import { driverPerformanceEntries } from "../../domain/driverForm.js";
import { managerGameplayEffects } from "../../domain/managerProfile.js";
import { tyresForTeam } from "../../domain/raceTyreModel.js";
import { carReliabilityProfile } from "../../domain/carReliability.js";
import {
  accidentConditionalRetirementChance,
  accidentIncidentChance,
  buildTrackWeatherTimeline,
  mechanicalRetirementChance,
  raceControlRulesForYear,
} from "../../engine/RaceControlEngine.js";
import { buildTrackModel } from "../track/TrackModel.js";
import {
  RACE_WEEKEND_CONTRACT_VERSION,
  RACE_WEEKEND_ENGINES,
  cloneRaceContractValue,
  normalizeRaceWeekendEngineVersion,
} from "../contracts/raceContracts.js";

const text=(value)=>String(value??"");
const idOf=(row)=>text(row?.driver_id??row?.id);
const teamIdOf=(row)=>text(row?.team_id??row?.constructor_id??row?.team);

function finite(value,fallback=null){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
}

function normalizedGp(gp,weekend){
  return {
    gp_id:text(gp?.gp_id??gp?.id??weekend?.gp_id)||null,
    name:gp?.gp_name??gp?.name??weekend?.gp_name??null,
    track_id:text(gp?.track_id??weekend?.track_id)||null,
    dateISO:gp?.dateISO??gp?.race_date??gp?.date??weekend?.raceDate??null,
  };
}

function normalizedEntries(gs,weekend){
  const source=Array.isArray(weekend?.entrants)&&weekend.entrants.length
    ?weekend.entrants
    :Array.isArray(gs?.raceEntryState?.entries)
      ?gs.raceEntryState.entries
      :[];
  return source.map((entry)=>({
    driverId:text(entry?.driver_id)||null,
    teamId:text(entry?.team_id)||null,
    carId:entry?.car_id==null?null:text(entry.car_id),
    status:entry?.status??null,
  }));
}

function normalizedDrivers(gs,entries){
  const driversById=new Map((gs?.drivers||[]).map((row)=>[idOf(row),row]));
  const ratingsById=new Map((gs?.driverRatings||[]).map((row)=>[idOf(row),row]));
  const teamByDriver=new Map(entries.filter((entry)=>entry.driverId).map((entry)=>[entry.driverId,entry.teamId]));
  return [...new Set(entries.map((entry)=>entry.driverId).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b))
    .map((driverId)=>{
      const rating=ratingsById.get(driverId)||{};
      const condition=conditionModifierBreakdown(gs,driverId);
      return {
        driverId,
        teamId:teamByDriver.get(driverId)||teamIdOf(driversById.get(driverId))||null,
        profile:cloneRaceContractValue(driversById.get(driverId)||{}),
        ratings:cloneRaceContractValue(rating),
        condition:cloneRaceContractValue(gs?.driverAttributes?.[driverId]||{}),
        availability:cloneRaceContractValue(gs?.driverAvailability?.[driverId]||null),
        performance:{
          raceScore:Number(raceDriverScore(rating,gs,driverId).toFixed(3)),
          conditionModifier:Number(Number(condition?.total||0).toFixed(3)),
          overtaking:finite(driverDerivedRating(rating,"overtaking"),null),
          defending:finite(driverDerivedRating(rating,"defending"),null),
          mistakePropensity:finite(
            driverMistakePropensity(rating,{
              performanceEntries:driverPerformanceEntries(gs,driverId),
            })?.value,
            null
          ),
          aggression:finite(rating?.aggression??rating?.agression,null),
          tyreManagement:finite(rating?.tire_management,60),
        },
      };
    });
}

function garageCarsForTeam(gs,teamId){
  const tid=text(teamId);
  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  if(tid&&playerTeamId&&tid===playerTeamId)return gs?.garage?.cars||[];
  return gs?.aiTechnicalWorld?.teams?.[tid]?.garage?.cars||[];
}

export function managerAdjustedPitCrew(gs,teamId,pitCrew){
  if(!pitCrew||typeof pitCrew!=="object")return pitCrew??null;
  const effects=managerGameplayEffects(gs,{teamId});
  if(!effects.active)return {...pitCrew};
  const baseError=Math.max(0,finite(pitCrew?.effective_error_chance,pitCrew?.error_rate??0.05));
  return {
    ...pitCrew,
    effective_error_chance:Number((baseError*effects.raceExecutionErrorMultiplier).toFixed(6)),
    manager_race_execution_multiplier:effects.raceExecutionErrorMultiplier,
  };
}

function normalizedCars(gs,entries){
  const seen=new Set();
  const cars=[];

  for(const entry of entries){
    if(!entry?.teamId||!entry?.carId||seen.has(entry.carId))continue;
    const car=(garageCarsForTeam(gs,entry.teamId)||[])
      .find((row)=>text(row?.id)===entry.carId);
    if(!car)continue;

    const performance=teamCarPerformance(gs,entry.teamId,entry.driverId||null);
    const selection=gs?.raceWeekendState?.race_strategy?.selections?.[entry.driverId]||null;
    const tyreOptions=tyresForTeam(gs,entry.teamId,{year:gs?.raceWeekendState?.year??gs?.activeYear})
      .map((row)=>({
        tyre_id:text(row?.tyre_id??row?.id)||null,
        supplier:row?.supplier??null,
        compound_name:row?.compound_name??row?.compound??row?.name??null,
        category:row?.category??"dry",
        grip_index:finite(row?.grip_index,75),
        wear_rate:finite(row?.wear_rate,0.018),
        warmup_time_s:finite(row?.warmup_time_s,2.5),
        wet_efficiency:finite(row?.wet_efficiency,null),
      }))
      .filter((row)=>row.tyre_id);
    const incidentRow=entry.driverId?{driver:{driver_id:entry.driverId}}:null;
    const reliabilityProfile=entry.driverId
      ?carReliabilityProfile(gs,entry.teamId,entry.driverId,{carOverride:car})
      :null;
    const reliability=entry.driverId
      ?{
        profile:cloneRaceContractValue(reliabilityProfile),
        mechanicalFailureChance:finite(
          mechanicalRetirementChance(gs,incidentRow,{
            teamIdOverride:entry.teamId,
            reliabilityProfileOverride:reliabilityProfile,
          }),
          0
        ),
        accidentIncidentChance:finite(accidentIncidentChance(gs,incidentRow),0),
        accidentConditionalRetirementChance:finite(
          accidentConditionalRetirementChance(gs,incidentRow),
          0
        ),
      }
      :null;
    seen.add(entry.carId);
    cars.push({
      carId:entry.carId,
      driverId:entry.driverId||null,
      teamId:entry.teamId,
      kind:car?.kind??null,
      state:cloneRaceContractValue(car),
      reliability:cloneRaceContractValue(reliability),
      resourceSetup:{
        strategy:cloneRaceContractValue(selection?{
          startTyreId:selection?.start_tyre_id??null,
          nextTyreId:selection?.next_tyre_id??null,
          paceMode:selection?.pace_mode??"balanced",
          fuelPlan:selection?.fuel_plan??null,
          pitPlan:selection?.pit_plan??null,
          plannedStopLap:finite(selection?.planned_stop_lap,null),
        }:null),
        pitCrew:cloneRaceContractValue(managerAdjustedPitCrew(
          gs,
          entry.teamId,
          gs?.raceStrategyWorld?.pitCrews?.[entry.teamId]??null
        )),
        tyres:cloneRaceContractValue(tyreOptions),
      },
      performance:{
        overall:finite(performance?.overall,70),
        qualifying:finite(performance?.qualifying,70),
        race:finite(performance?.race,70),
        reliability:finite(performance?.reliability,75),
        chassis:finite(performance?.chassis,70),
        power:finite(performance?.power,70),
        technicalDelta:cloneRaceContractValue(performance?.technical_delta||{}),
        wearPenalty:cloneRaceContractValue(performance?.wear_penalty||{}),
      },
    });
  }

  return cars.sort((a,b)=>a.carId.localeCompare(b.carId));
}

export function buildRaceWeekendInput(gs,{gp=null,engineVersion=null}={}){
  const weekend=gs?.raceWeekendState||null;
  const entries=normalizedEntries(gs,weekend);
  const lockedEngine=weekend
    ?normalizeRaceWeekendEngineVersion(weekend.engine_version,{fallback:RACE_WEEKEND_ENGINES.LEGACY})
    :normalizeRaceWeekendEngineVersion(engineVersion,{fallback:RACE_WEEKEND_ENGINES.LEGACY});
  const roundIndex=finite(weekend?.roundIndex,finite(gs?.currentRound,0));
  const year=finite(weekend?.year,finite(gs?.activeYear,null));
  const track=buildTrackModel(gs,{
    gp,
    trackId:weekend?.track_id??gp?.track_id??null,
    year:weekend?.year??gs?.activeYear??gp?.year??null,
    trackSnapshot:weekend?.race_strategy?.track_snapshot??null,
  });
  const weatherSnapshot=cloneRaceContractValue(
    weekend?.race_strategy?.weather_snapshot
    ??weekend?.weekend_weather
    ??{}
  );
  const weatherSourceState={
    ...gs,
    raceEntryState:{
      ...(gs?.raceEntryState||{}),
      entries:entries.map((entry)=>({
        driver_id:entry.driverId,
        team_id:entry.teamId,
        car_id:entry.carId,
        status:entry.status,
      })),
    },
  };
  const weatherTimeline=track
    ?buildTrackWeatherTimeline(weatherSourceState,weatherSnapshot||{},{
      track_id:track.trackId,
      laps:track.laps,
      drainage_rating:finite(track?.traits?.drainage,0.5),
    })
    :[];
  const weather={
    ...(weatherSnapshot||{}),
    timeline:cloneRaceContractValue(weatherTimeline),
  };

  return {
    schemaVersion:RACE_WEEKEND_CONTRACT_VERSION,
    engineVersion:lockedEngine,
    weekendKey:weekend?.key??null,
    seed:getSaveSeed(gs),
    year,
    round:finite(weekend?.round,roundIndex==null?null:roundIndex+1),
    gp:normalizedGp(gp,weekend),
    entries:cloneRaceContractValue(entries),
    drivers:normalizedDrivers(gs,entries),
    cars:normalizedCars(gs,entries),
    rules:cloneRaceContractValue({
      qualifying:weekend?.qualifying_rule_snapshot??null,
      race:weekend?.race_strategy?.rules_snapshot??null,
      points:gs?.pointsSystem??null,
    }),
    track:cloneRaceContractValue(track),
    weather:cloneRaceContractValue(weather),
    raceControl:cloneRaceContractValue({
      rules:raceControlRulesForYear(year),
    }),
    startingGrid:cloneRaceContractValue(
      weekend?.startingGrid?.rows
      ??weekend?.grid
      ??[]
    ),
  };
}
