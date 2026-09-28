// src/domain/raceCarGeometry.js
// Cars 4.1B — declarative 1980 Race View geometry families.
// Values are normalized presentation-space proportions, not simulation physics.
// Historical dimensions and visual references inform the relative silhouettes,
// while bounded extents keep the existing presentation occupancy model stable.

const BASE=Object.freeze({
  rearBodyX:-14.2,
  rearBodyHalfWidth:5.15,
  sidepodRearX:-6.6,
  sidepodRearHalfWidth:6.0,
  sidepodFrontX:4.9,
  sidepodFrontHalfWidth:5.55,
  shoulderX:7.9,
  shoulderHalfWidth:4.45,
  noseBaseX:8.8,
  noseBaseHalfWidth:2.8,
  noseShoulderX:15.2,
  noseShoulderHalfWidth:1.8,
  noseTipX:20.0,
  rearAxleX:-10.8,
  rearTrackY:8.0,
  rearTyreLength:8.35,
  rearTyreWidth:5.1,
  frontAxleX:12.9,
  frontTrackY:8.35,
  frontTyreLength:6.75,
  frontTyreWidth:4.0,
  rearWingX:-19.15,
  rearWingHalfWidth:9.55,
  rearWingThickness:2.75,
  frontWingX:18.65,
  frontWingHalfWidth:9.15,
  frontWingThickness:1.8,
  cockpitX:-3.35,
  cockpitLength:6.8,
  cockpitHalfWidth:1.95,
});

export const RACE_CAR_GEOMETRY_FAMILIES_1980=Object.freeze({
  classic_wedge:Object.freeze({...BASE}),
  narrow_wedge:Object.freeze({
    ...BASE,
    rearBodyHalfWidth:4.85,
    sidepodRearHalfWidth:5.55,
    sidepodFrontHalfWidth:5.25,
    shoulderHalfWidth:4.15,
    noseTipX:20.35,
    rearTrackY:7.85,
    frontTrackY:8.3,
    rearWingHalfWidth:9.35,
  }),
  long_venturi:Object.freeze({
    ...BASE,
    rearBodyX:-14.55,
    rearBodyHalfWidth:5.35,
    sidepodRearX:-7.0,
    sidepodRearHalfWidth:6.15,
    sidepodFrontX:5.35,
    sidepodFrontHalfWidth:5.8,
    shoulderX:8.15,
    noseTipX:20.35,
    rearAxleX:-11.2,
    frontAxleX:13.2,
    rearTrackY:7.95,
    frontTrackY:8.35,
    rearWingX:-19.4,
    frontWingX:18.9,
    cockpitX:-3.15,
  }),
  turbo_long:Object.freeze({
    ...BASE,
    rearBodyX:-14.75,
    rearBodyHalfWidth:5.55,
    sidepodRearX:-7.2,
    sidepodRearHalfWidth:6.25,
    sidepodFrontX:5.55,
    sidepodFrontHalfWidth:5.95,
    shoulderX:8.25,
    shoulderHalfWidth:4.65,
    noseTipX:20.55,
    rearAxleX:-11.5,
    frontAxleX:13.5,
    rearTrackY:8.0,
    frontTrackY:8.4,
    rearWingX:-19.55,
    frontWingX:19.0,
    frontWingHalfWidth:9.45,
    cockpitX:-3.0,
  }),
  wide_flat12:Object.freeze({
    ...BASE,
    rearBodyX:-14.45,
    rearBodyHalfWidth:5.8,
    sidepodRearX:-6.75,
    sidepodRearHalfWidth:6.35,
    sidepodFrontHalfWidth:6.0,
    shoulderHalfWidth:4.75,
    noseTipX:20.05,
    rearAxleX:-10.85,
    frontAxleX:12.85,
    rearTrackY:8.15,
    frontTrackY:8.6,
    rearTyreWidth:5.3,
    rearWingHalfWidth:10.0,
    frontWingHalfWidth:9.8,
    cockpitX:-3.55,
  }),
  compact_transition:Object.freeze({
    ...BASE,
    rearBodyX:-13.85,
    rearBodyHalfWidth:4.95,
    sidepodRearX:-6.2,
    sidepodRearHalfWidth:5.45,
    sidepodFrontX:4.55,
    sidepodFrontHalfWidth:5.15,
    shoulderX:7.55,
    shoulderHalfWidth:4.05,
    noseBaseX:8.45,
    noseBaseHalfWidth:2.55,
    noseShoulderX:14.8,
    noseTipX:19.55,
    rearAxleX:-10.6,
    frontAxleX:12.8,
    rearTrackY:7.8,
    frontTrackY:8.25,
    rearWingX:-18.85,
    rearWingHalfWidth:9.25,
    frontWingX:18.25,
    frontWingHalfWidth:9.05,
    cockpitX:-3.05,
    cockpitLength:6.45,
  }),
  late_ground_effect:Object.freeze({
    ...BASE,
    rearBodyX:-14.05,
    rearBodyHalfWidth:5.1,
    sidepodRearX:-6.5,
    sidepodRearHalfWidth:5.75,
    sidepodFrontX:5.15,
    sidepodFrontHalfWidth:5.55,
    shoulderX:7.75,
    shoulderHalfWidth:4.2,
    noseBaseX:8.7,
    noseBaseHalfWidth:2.45,
    noseShoulderX:15.0,
    noseShoulderHalfWidth:1.65,
    noseTipX:19.7,
    rearAxleX:-10.8,
    frontAxleX:13.0,
    rearTrackY:7.9,
    frontTrackY:8.35,
    rearWingX:-19.0,
    rearWingHalfWidth:9.4,
    frontWingX:18.35,
    frontWingHalfWidth:9.35,
    cockpitX:-2.75,
    cockpitLength:6.35,
  }),
});

const MODEL_PROFILES_1980=Object.freeze({
  FW07:{family:"classic_wedge",params:{noseTipX:20.2,sidepodRearHalfWidth:5.9,frontWingHalfWidth:9.25}},
  FW07B:{family:"classic_wedge",params:{sidepodRearHalfWidth:6.05,sidepodFrontHalfWidth:5.65,frontTrackY:8.45,rearWingHalfWidth:9.65}},
  "JS11/15":{family:"classic_wedge",params:{noseTipX:19.55,sidepodRearHalfWidth:6.2,sidepodFrontHalfWidth:5.85,frontWingHalfWidth:9.7,cockpitX:-2.85}},
  BT49:{family:"narrow_wedge",params:{rearBodyX:-13.95,noseTipX:20.45,frontTrackY:8.4,cockpitX:-3.55}},
  RE20:{family:"turbo_long",params:{sidepodRearHalfWidth:6.35,sidepodFrontHalfWidth:6.05,rearBodyHalfWidth:5.65,frontWingHalfWidth:9.55}},
  "81":{family:"long_venturi",params:{rearBodyHalfWidth:5.45,sidepodRearHalfWidth:6.25,sidepodFrontHalfWidth:5.95,cockpitX:-3.0}},
  "81B":{family:"long_venturi",params:{sidepodRearHalfWidth:6.3,sidepodFrontHalfWidth:6.0,frontWingHalfWidth:9.45,cockpitX:-2.9}},
  "009":{family:"compact_transition",params:{sidepodRearHalfWidth:5.6,noseTipX:19.8,rearWingHalfWidth:9.35,cockpitX:-3.35}},
  "010":{family:"compact_transition",params:{sidepodRearHalfWidth:5.25,sidepodFrontHalfWidth:5.05,noseTipX:19.65,cockpitX:-2.85}},
  A3:{family:"compact_transition",params:{sidepodRearHalfWidth:5.6,sidepodFrontHalfWidth:5.35,noseTipX:19.9,frontWingHalfWidth:9.25}},
  F7:{family:"classic_wedge",params:{sidepodRearHalfWidth:5.8,sidepodFrontHalfWidth:5.5,rearWingHalfWidth:9.35}},
  F8:{family:"late_ground_effect",params:{sidepodRearHalfWidth:5.85,sidepodFrontHalfWidth:5.65,noseTipX:19.55,cockpitX:-2.65}},
  M29:{family:"narrow_wedge",params:{rearBodyX:-14.25,sidepodRearHalfWidth:5.7,sidepodFrontHalfWidth:5.35,noseTipX:20.15,cockpitX:-3.2}},
  M30:{family:"late_ground_effect",params:{sidepodRearHalfWidth:5.9,sidepodFrontHalfWidth:5.7,noseTipX:19.35,cockpitX:-2.45,frontWingHalfWidth:9.5}},
  "312T5":{family:"wide_flat12",params:{rearBodyHalfWidth:5.95,sidepodRearHalfWidth:6.45,sidepodFrontHalfWidth:6.05,frontWingHalfWidth:9.95,rearWingHalfWidth:10.05}},
  "179":{family:"wide_flat12",params:{rearBodyHalfWidth:5.7,sidepodRearHalfWidth:6.2,sidepodFrontHalfWidth:5.85,noseTipX:20.25,rearWingHalfWidth:9.8}},
  D3:{family:"narrow_wedge",params:{sidepodRearHalfWidth:5.5,sidepodFrontHalfWidth:5.2,noseTipX:20.1,rearWingHalfWidth:9.2}},
  D4:{family:"compact_transition",params:{sidepodRearHalfWidth:5.35,sidepodFrontHalfWidth:5.1,noseTipX:19.7,cockpitX:-2.9}},
  N180:{family:"compact_transition",params:{sidepodRearHalfWidth:5.45,noseTipX:19.45,frontWingHalfWidth:8.95,cockpitX:-3.0}},
  FA1:{family:"late_ground_effect",params:{rearBodyHalfWidth:5.25,sidepodRearHalfWidth:5.95,sidepodFrontHalfWidth:5.75,frontWingHalfWidth:9.55}},
  DN11:{family:"narrow_wedge",params:{rearBodyHalfWidth:4.75,sidepodRearHalfWidth:5.45,noseTipX:20.3,rearWingHalfWidth:9.15}},
  DN12:{family:"late_ground_effect",params:{rearBodyHalfWidth:5.0,sidepodRearHalfWidth:5.65,sidepodFrontHalfWidth:5.45,noseTipX:19.6,cockpitX:-2.7}},
});

const MODEL_ALIASES_1980=Object.freeze({
  "FW07/FW07B":"FW07B",
  "81/81B":"81",
  "009/010":"010",
  "F7/F8":"F7",
  "M29/M30":"M29",
  "D3/D4":"D4",
  "DN11/DN12":"DN11",
});

function modelKey(value){
  return String(value||"").trim().toUpperCase().replace(/\s+/g,"");
}

export function historicalRaceCarGeometry({year,model}={}){
  if(Number(year)!==1980)return null;
  const raw=modelKey(model);
  const resolved=MODEL_ALIASES_1980[raw]||raw;
  const profile=MODEL_PROFILES_1980[resolved];
  const family=profile?.family||"classic_wedge";
  const familyParams=RACE_CAR_GEOMETRY_FAMILIES_1980[family]||RACE_CAR_GEOMETRY_FAMILIES_1980.classic_wedge;
  return {
    year:1980,
    model:resolved||"1980_GENERIC",
    geometry_family:family,
    ...familyParams,
    ...(profile?.params||{}),
  };
}

export function historicalRaceCarGeometryModelsForYear(year){
  if(Number(year)!==1980)return [];
  return Object.entries(MODEL_PROFILES_1980).map(([model,profile])=>({
    year:1980,
    model,
    geometry_family:profile.family,
    ...RACE_CAR_GEOMETRY_FAMILIES_1980[profile.family],
    ...(profile.params||{}),
  }));
}

export function historicalRaceCarGeometryFamiliesForYear(year){
  if(Number(year)!==1980)return [];
  return Object.entries(RACE_CAR_GEOMETRY_FAMILIES_1980).map(([geometry_family,params])=>({
    year:1980,
    geometry_family,
    ...params,
  }));
}
