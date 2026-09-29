// src/domain/raceControlPaceModel.js
// Shared Race Control timing/pace calibration for Legacy and RW2.
//
// These values preserve the established RaceStrategy/LiveRace calibration.
// RW2 converts the same whole-lap deltas into continuous target-speed limits.

const finite=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,finite(value,min)));

export const RACE_CONTROL_MODES=Object.freeze({
  GREEN:"GREEN",
  LOCAL_YELLOW:"LOCAL_YELLOW",
  VSC:"VSC",
  SAFETY_CAR:"SAFETY_CAR",
  RED_FLAG:"RED_FLAG",
});

export function normalizeRaceControlMode(value){
  const mode=String(value??"GREEN").trim().toUpperCase();
  return Object.values(RACE_CONTROL_MODES).includes(mode)
    ?mode
    :RACE_CONTROL_MODES.GREEN;
}

export function raceControlLapDeltaS(modeInput,{positionIndex=0}={}){
  const mode=normalizeRaceControlMode(modeInput);
  const index=Math.max(0,Math.floor(finite(positionIndex,0)));
  if(mode===RACE_CONTROL_MODES.SAFETY_CAR)return Math.max(12,18-index*0.30);
  if(mode===RACE_CONTROL_MODES.VSC)return 7.5;
  if(mode===RACE_CONTROL_MODES.RED_FLAG)return 26;
  if(mode===RACE_CONTROL_MODES.LOCAL_YELLOW)return 1.2;
  return 0;
}

export function raceControlPitLaneLossMultiplier(modeInput){
  const mode=normalizeRaceControlMode(modeInput);
  if(mode===RACE_CONTROL_MODES.SAFETY_CAR)return 0.58;
  if(mode===RACE_CONTROL_MODES.VSC)return 0.76;
  if(mode===RACE_CONTROL_MODES.RED_FLAG)return 0.35;
  return 1;
}

export function raceControlDurationLaps(modeInput,roll=0.5){
  const mode=normalizeRaceControlMode(modeInput);
  const unit=clamp(roll,0,0.999999);
  if(mode===RACE_CONTROL_MODES.SAFETY_CAR)return 2+Math.floor(unit*3);
  if(mode===RACE_CONTROL_MODES.VSC)return 1+Math.floor(unit*2);
  return mode===RACE_CONTROL_MODES.GREEN?0:1;
}

export function raceControlOvertakingAllowed(modeInput){
  return normalizeRaceControlMode(modeInput)===RACE_CONTROL_MODES.GREEN;
}

export function raceControlIsGlobal(modeInput){
  const mode=normalizeRaceControlMode(modeInput);
  return [
    RACE_CONTROL_MODES.VSC,
    RACE_CONTROL_MODES.SAFETY_CAR,
    RACE_CONTROL_MODES.RED_FLAG,
  ].includes(mode);
}

export function raceControlPaceMultiplier(modeInput,{
  referenceLapMs=90000,
  positionIndex=0,
  localFraction=1/3,
}={}){
  const mode=normalizeRaceControlMode(modeInput);
  if(mode===RACE_CONTROL_MODES.GREEN||mode===RACE_CONTROL_MODES.RED_FLAG)return mode===RACE_CONTROL_MODES.GREEN?1:0;

  const lapS=Math.max(20,finite(referenceLapMs,90000)/1000);
  const deltaS=raceControlLapDeltaS(mode,{positionIndex});
  if(deltaS<=0)return 1;

  if(mode===RACE_CONTROL_MODES.LOCAL_YELLOW){
    const fraction=clamp(localFraction,0.05,1);
    const localS=lapS*fraction;
    return clamp(localS/(localS+deltaS),0.35,1);
  }
  return clamp(lapS/(lapS+deltaS),0.35,1);
}
