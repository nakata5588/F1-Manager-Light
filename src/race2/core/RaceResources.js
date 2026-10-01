// src/race2/core/RaceResources.js
// RW8.7: canonical tyres, fuel and temperature state for RW2.
//
// The core consumes detached race input snapshots only. Tyre wear is integrated
// from real distance travelled, fuel burn from real distance, and temperatures
// evolve on fixed time steps. Pit stops/refuelling are intentionally deferred.

import {
  RACE_PACE_MODES,
  genericTyresForYear,
  optimalTyreTemperatureC,
  projectedTyreWearPerLap,
  tyreConditionEffects,
} from "../../domain/raceTyreModel.js";

const finite=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,finite(value,min)));
const round=(value,digits=6)=>{
  const parsed=finite(value,null);
  return parsed==null?null:Number(parsed.toFixed(digits));
};

function paceModeOf(car){
  const id=String(car?.resources?.paceMode??car?.resourceSetup?.strategy?.paceMode??"balanced");
  return RACE_PACE_MODES[id]?id:"balanced";
}

export function raceTrackTempC(stateLike){
  const explicit=finite(
    stateLike?.trackState?.trackTemp
    ??stateLike?.weatherState?.track_temp_c
    ??stateLike?.weatherState?.track?.track_temp_c
    ??stateLike?.weather?.track_temp_c
    ??stateLike?.weather?.track?.track_temp_c,
    null
  );
  if(explicit!=null)return explicit;
  const air=finite(
    stateLike?.weatherState?.air_temp_c
    ??stateLike?.weatherState?.avg_temp_c
    ??stateLike?.weather?.air_temp_c
    ??stateLike?.weather?.avg_temp_c,
    22
  );
  return air+8;
}

function tyreOptionsFor(inputCar,year){
  const supplied=Array.isArray(inputCar?.resourceSetup?.tyres)
    ?inputCar.resourceSetup.tyres
    :[];
  return supplied.length?supplied:genericTyresForYear(year);
}

export function freshRaceTyre(option,{
  trackTempC=30,
  tyreManagement=60,
  stintNumber=1,
}={}){
  const chosen=option||{};
  const optimum=optimalTyreTemperatureC(chosen);
  const startingTemp=clamp(finite(trackTempC,30)+18,40,optimum-4);
  const effects=tyreConditionEffects(100);
  return {
    tyre_id:String(chosen?.tyre_id??chosen?.id??""),
    supplier:chosen?.supplier??null,
    compound:chosen?.compound_name??chosen?.compound??chosen?.name??null,
    category:chosen?.category??"dry",
    grip_index:round(finite(chosen?.grip_index,75),3),
    wear_rate:round(finite(chosen?.wear_rate,0.018),6),
    warmup_time_s:round(finite(chosen?.warmup_time_s,2.5),3),
    wet_efficiency:finite(chosen?.wet_efficiency,null),
    condition:100,
    temperature_c:round(startingTemp,3),
    temperature_target_c:round(startingTemp,3),
    temperature_trend_c_per_s:0,
    optimal_temperature_c:round(optimum,3),
    thermal_stress_multiplier:1,
    age_distance_m:0,
    age_laps:0,
    stint_number:Math.max(1,Math.round(finite(stintNumber,1))),
    wear_per_lap_pct:0,
    grip_multiplier:effects.grip_multiplier,
    pace_penalty_s:effects.pace_penalty_s,
    risk_multiplier:effects.risk_multiplier,
    band:effects.band,
    tyre_management:round(finite(tyreManagement,60),3),
  };
}

function initialTyre(input,inputCar,driver){
  const year=finite(input?.year,input?.track?.year??1980);
  const options=tyreOptionsFor(inputCar,year);
  const requested=String(inputCar?.resourceSetup?.strategy?.startTyreId??"");
  const chosen=options.find((row)=>String(row?.tyre_id??row?.id??"")===requested)
    ??options.filter((row)=>String(row?.category||"dry")==="dry")
      .sort((a,b)=>finite(b?.grip_index,75)-finite(a?.grip_index,75))[0]
    ??options[0]
    ??genericTyresForYear(year)[0];

  return freshRaceTyre(chosen,{
    trackTempC:raceTrackTempC(input),
    tyreManagement:driver?.performance?.tyreManagement,
    stintNumber:1,
  });
}

export function fuelBurnKgPerKmForYear(yearInput){
  const year=finite(yearInput,1980);
  if(year<=1960)return 0.52;
  if(year<=1977)return 0.48;
  if(year<=1988)return 0.54;
  if(year<=1993)return 0.46;
  if(year<=2009)return 0.43;
  if(year<=2013)return 0.39;
  return 0.36;
}

function initialFuel(input,inputCar){
  const lengthM=Math.max(1,finite(input?.track?.lengthM,5000));
  const laps=Math.max(1,Math.round(finite(input?.track?.laps,61)));
  const raceKm=(lengthM*laps)/1000;
  const burn=fuelBurnKgPerKmForYear(input?.year??input?.track?.year);
  const refuellingAllowed=Boolean(input?.rules?.race?.refuelling_allowed);
  const plannedStopLap=Math.max(
    0,
    Math.round(finite(inputCar?.resourceSetup?.strategy?.plannedStopLap,0))
  );
  const hasPlannedRefuelStint=
    refuellingAllowed&&
    plannedStopLap>=1&&
    plannedStopLap<laps;
  const stintKm=hasPlannedRefuelStint
    ?(lengthM*plannedStopLap)/1000
    :raceKm;

  const worstNormalBurn=stintKm*burn*1.04*1.05;
  const reserve=Math.max(1.5,worstNormalBurn*0.03);
  const initial=worstNormalBurn+reserve;
  return {
    fuelKg:round(initial,6),
    initialFuelKg:round(initial,6),
    burnKgPerKm:round(burn,6),
    reserveKg:round(reserve,6),
    fuelPlan:inputCar?.resourceSetup?.strategy?.fuelPlan??null,
    refuellingDeferred:refuellingAllowed,
    fuelStintPlanned:hasPlannedRefuelStint,
    plannedFuelStopLap:hasPlannedRefuelStint?plannedStopLap:null,
  };
}
export function initialRaceResources(input,inputCar,driver){
  const fuel=initialFuel(input,inputCar);
  const tyre=initialTyre(input,inputCar,driver);
  const paceMode=String(inputCar?.resourceSetup?.strategy?.paceMode??"balanced");
  return {
    tyre,
    fuelKg:fuel.fuelKg,
    engineTemperature:82,
    resources:{
      paceMode:RACE_PACE_MODES[paceMode]?paceMode:"balanced",
      strategy:{
        nextTyreId:inputCar?.resourceSetup?.strategy?.nextTyreId??null,
        pitPlan:inputCar?.resourceSetup?.strategy?.pitPlan??null,
        plannedStopLap:finite(inputCar?.resourceSetup?.strategy?.plannedStopLap,null),
        fuelPlan:inputCar?.resourceSetup?.strategy?.fuelPlan??null,
        tyreChangeRequested:true,
        refuelRequested:fuel.fuelStintPlanned,
      },
      availableTyres:tyreOptionsFor(inputCar,finite(input?.year,input?.track?.year??1980))
        .map((row)=>({
          tyre_id:String(row?.tyre_id??row?.id??""),
          supplier:row?.supplier??null,
          compound_name:row?.compound_name??row?.compound??row?.name??null,
          category:row?.category??"dry",
          grip_index:finite(row?.grip_index,75),
          wear_rate:finite(row?.wear_rate,0.018),
          warmup_time_s:finite(row?.warmup_time_s,2.5),
          wet_efficiency:finite(row?.wet_efficiency,null),
        }))
        .filter((row)=>row.tyre_id),
      initialFuelKg:fuel.initialFuelKg,
      fuelBurnKgPerKm:fuel.burnKgPerKm,
      fuelReserveKg:fuel.reserveKg,
      fuelPlan:fuel.fuelPlan,
      refuellingDeferred:fuel.refuellingDeferred,
      fuelStintPlanned:fuel.fuelStintPlanned,
      plannedFuelStopLap:fuel.plannedFuelStopLap,
      pitCrew:inputCar?.resourceSetup?.pitCrew
        ?{...inputCar.resourceSetup.pitCrew}
        :null,
      tyreGripMultiplier:1,
      tyreTemperaturePenalty:0,
      fuelMassPenalty:0,
      engineTemperaturePenalty:0,
      paceMultiplier:1,
      accelerationMultiplier:1,
    },
  };
}

export function raceTrackWetness(stateLike){
  return clamp(finite(
    stateLike?.trackState?.wetness
    ??stateLike?.weatherState?.track_wetness
    ??stateLike?.weatherState?.current?.track_wetness
    ??stateLike?.weather?.track_wetness,
    0
  ),0,1);
}

export function canonicalTyreTemperatureTargetC(state,car){
  const tyre=car?.tyre||{};
  const optimum=finite(tyre?.optimal_temperature_c,optimalTyreTemperatureC(tyre));
  const trackTemp=raceTrackTempC(state);
  const speedKmh=Math.max(0,finite(car?.speedKmh,finite(car?.speedMs,0)*3.6));
  const acceleration=finite(car?.accelerationMs2,0);
  const cornerSeverity=clamp(finite(car?.effectiveCornerSeverity,0),0,1);
  const pace=paceModeOf(car);
  const paceDelta=pace==="attack"?5:pace==="conserve"?-4:0;

  // A stationary tyre should cool toward the circuit rather than magically
  // heating to its optimum. Normal race speed supplies the baseline carcass
  // energy; braking, traction and lateral load then create the useful peaks.
  const restingTarget=clamp(trackTemp+14,30,Math.max(30,optimum-8));
  const motionFraction=clamp(speedKmh/180,0,1);
  const baseTarget=restingTarget+(optimum-restingTarget)*motionFraction;
  const cornerHeat=cornerSeverity*clamp(speedKmh/220,0,1.25)*8;
  const brakingHeat=clamp(-acceleration/18,0,1)*7;
  const tractionHeat=clamp(acceleration/12,0,1)*4;
  const battleHeat=car?.battle?.phase==="side_by_side"?2.5:0;
  const straightCooling=clamp((speedKmh-210)/140,0,1)*(1-cornerSeverity)*8;

  const wetness=raceTrackWetness(state);
  const category=String(tyre?.category||"dry").toLowerCase();
  const wetCoolingFactor=category==="wet"?2:category==="intermediate"?5:10;
  const wetCooling=wetness*wetCoolingFactor;

  return clamp(
    baseTarget+
      paceDelta+
      cornerHeat+
      brakingHeat+
      tractionHeat+
      battleHeat-
      straightCooling-
      wetCooling,
    Math.max(20,trackTemp+4),
    optimum+26
  );
}

export function tyreThermalStressMultiplier(tyre,temperatureC){
  const optimum=finite(tyre?.optimal_temperature_c,optimalTyreTemperatureC(tyre));
  const delta=finite(temperatureC,optimum)-optimum;
  if(delta>8)return 1+Math.min(0.35,(delta-8)*0.02);
  if(delta<-25)return 1+Math.min(0.12,(-delta-25)*0.006);
  return 1;
}

function tyreWearDriverMultiplier(car){
  const management=clamp(finite(car?.tyre?.tyre_management,60),0,100);
  return clamp(1+(60-management)*0.004,0.74,1.32);
}

function tyreTrackWearMultiplier(state){
  const wear=clamp(finite(state?.track?.traits?.tyreWear,50),0,100);
  return 0.62+(wear/100)*0.72;
}

function updateTyre(state,previous,next,deltaM,stepMs){
  const tyre={...(previous?.tyre||next?.tyre||{})};
  if(!tyre?.tyre_id)return tyre;

  const dt=Math.max(0.01,finite(stepMs,100)/1000);
  const currentTemp=finite(tyre?.temperature_c,raceTrackTempC(state)+18);
  const targetTemp=canonicalTyreTemperatureTargetC(state,{...previous,...next,tyre});
  const warmupTime=Math.max(0.5,finite(tyre?.warmup_time_s,2.5));
  const tau=Math.max(6,warmupTime*5);
  const alpha=1-Math.exp(-dt/tau);
  const nextTemp=currentTemp+(targetTemp-currentTemp)*alpha;
  const temperatureTrend=(nextTemp-currentTemp)/dt;
  const thermalStress=tyreThermalStressMultiplier(tyre,nextTemp);

  const wearPerLap=projectedTyreWearPerLap(tyre,{
    trackWearMult:tyreTrackWearMultiplier(state),
    paceMode:paceModeOf(previous),
    wearDriverMult:tyreWearDriverMultiplier(previous),
    hotWearMult:thermalStress,
  });
  const lengthM=Math.max(1,finite(state?.track?.lengthM,1));
  const wearPct=wearPerLap*(Math.max(0,deltaM)/lengthM);
  const condition=clamp(finite(tyre?.condition,100)-wearPct,0,100);
  const ageDistance=Math.max(0,finite(tyre?.age_distance_m,0)+Math.max(0,deltaM));
  const effects=tyreConditionEffects(condition);

  return {
    ...tyre,
    condition:round(condition,6),
    temperature_c:round(nextTemp,6),
    temperature_target_c:round(targetTemp,6),
    temperature_trend_c_per_s:round(temperatureTrend,6),
    thermal_stress_multiplier:round(thermalStress,6),
    age_distance_m:round(ageDistance,6),
    age_laps:round(ageDistance/lengthM,6),
    wear_per_lap_pct:round(wearPerLap,6),
    grip_multiplier:effects.grip_multiplier,
    pace_penalty_s:effects.pace_penalty_s,
    risk_multiplier:effects.risk_multiplier,
    band:effects.band,
  };
}

function updateFuel(state,previous,deltaM){
  const resources=previous?.resources||{};
  const pace=RACE_PACE_MODES[paceModeOf(previous)]||RACE_PACE_MODES.balanced;
  const paceFuelMult=pace.id==="attack"?1.04:pace.id==="conserve"?0.96:1;
  const power=clamp(finite(previous?.performance?.car?.power,70),0,100);
  const powerMult=0.95+(power/100)*0.10;
  const burnPerKm=Math.max(0,finite(resources?.fuelBurnKgPerKm,fuelBurnKgPerKmForYear(state?.track?.year)));
  const used=burnPerKm*(Math.max(0,deltaM)/1000)*paceFuelMult*powerMult;
  return Math.max(0,finite(previous?.fuelKg,0)-used);
}

function updateEngineTemperature(state,previous,next,stepMs){
  const current=finite(previous?.engineTemperature,82);
  const dt=Math.max(0.01,finite(stepMs,100)/1000);
  const pace=paceModeOf(previous);
  const power=clamp(finite(previous?.performance?.car?.power,70),0,100);
  const speedKmh=Math.max(0,finite(next?.speedKmh,previous?.speedKmh??0));
  const paceDelta=pace==="attack"?7:pace==="conserve"?-4:0;
  const cooling=clamp(speedKmh/350*9,0,9);
  const ambient=raceTrackTempC(state);
  const coolingDamage=clamp(
    finite(next?.damage?.cooling_damage_pct,previous?.damage?.cooling_damage_pct??0),
    0,
    100
  );
  const target=88+power*0.09+paceDelta+(ambient-28)*0.10-cooling+coolingDamage*0.12;
  const alpha=1-Math.exp(-dt/18);
  return clamp(current+(target-current)*alpha,55,135);
}

export function raceResourcePerformance(car){
  const tyre=car?.tyre||{};
  const resources=car?.resources||{};
  const conditionGrip=clamp(finite(tyre?.grip_multiplier,1),0.65,1.05);
  const baseGrip=clamp(0.92+(finite(tyre?.grip_index,75)-70)*0.006,0.90,1.05);
  const tempDelta=Math.abs(
    finite(tyre?.temperature_c,90)-finite(tyre?.optimal_temperature_c,90)
  );
  const tempPenalty=clamp(Math.max(0,tempDelta-6)*0.0035,0,0.12);
  const tyreFactor=clamp(baseGrip*conditionGrip*(1-tempPenalty),0.72,1.05);

  const initialFuel=Math.max(1,finite(resources?.initialFuelKg,finite(car?.fuelKg,1)));
  const fuelFraction=clamp(finite(car?.fuelKg,0)/initialFuel,0,1);
  const fuelMassPenalty=0.022*fuelFraction;
  const reserveFuel=Math.max(0.1,finite(resources?.fuelReserveKg,1.5));
  const fuelKg=Math.max(0,finite(car?.fuelKg,0));
  const fuelStarvationPenalty=fuelKg<reserveFuel
    ?clamp(((reserveFuel-fuelKg)/reserveFuel)*0.45,0,0.45)
    :0;

  const engineTemp=finite(car?.engineTemperature,90);
  const enginePenalty=engineTemp>108
    ?clamp((engineTemp-108)*0.004,0,0.10)
    :engineTemp<65
      ?clamp((65-engineTemp)*0.002,0,0.04)
      :0;

  const pace=paceModeOf(car);
  const paceFactor=pace==="attack"?1.007:pace==="conserve"?0.992:1;
  const paceMultiplier=clamp(
    tyreFactor*(1-fuelMassPenalty)*(1-fuelStarvationPenalty)*(1-enginePenalty)*paceFactor,
    0.68,
    1.06
  );
  const accelerationMultiplier=clamp(
    (1-fuelMassPenalty*1.7)*(1-fuelStarvationPenalty)*(1-enginePenalty),
    0.78,
    1.02
  );

  return {
    paceMultiplier:round(paceMultiplier,6),
    accelerationMultiplier:round(accelerationMultiplier,6),
    tyreGripMultiplier:round(tyreFactor,6),
    tyreTemperaturePenalty:round(tempPenalty,6),
    fuelMassPenalty:round(fuelMassPenalty,6),
    fuelStarvationPenalty:round(fuelStarvationPenalty,6),
    engineTemperaturePenalty:round(enginePenalty,6),
  };
}

export function advanceRaceResources(state,cars,{stepMs=100}={}){
  const previousById=new Map((state?.cars||[]).map((car)=>[car?.carId,car]));
  return (cars||[]).map((next)=>{
    const originalPrevious=previousById.get(next?.carId);
    if(!originalPrevious||originalPrevious?.dnf||originalPrevious?.status==="dnf"||originalPrevious?.status==="finished"){
      return next;
    }
    const serviceApplied=Boolean(next?.pitState?.serviceAppliedThisStep);
    const previous=serviceApplied
      ?{
        ...originalPrevious,
        tyre:next?.tyre??originalPrevious?.tyre,
        fuelKg:finite(next?.fuelKg,originalPrevious?.fuelKg),
        resources:next?.resources??originalPrevious?.resources,
      }
      :originalPrevious;
    const deltaM=Math.max(
      0,
      finite(next?.absoluteDistanceM,0)-finite(originalPrevious?.absoluteDistanceM,0)
    );
    const tyre=updateTyre(state,previous,next,deltaM,stepMs);
    const fuelKg=updateFuel(state,previous,deltaM);
    const engineTemperature=updateEngineTemperature(state,originalPrevious,next,stepMs);
    const provisional={
      ...next,
      tyre,
      fuelKg:round(fuelKg,6),
      engineTemperature:round(engineTemperature,6),
    };
    const effects=raceResourcePerformance(provisional);
    return {
      ...provisional,
      resources:{
        ...(previous?.resources||{}),
        ...(next?.resources||{}),
        ...effects,
      },
    };
  });
}
