// src/engine/CarDamageEngine.js
// RW5.3A — persistent race damage foundation.
//
// Damage is intentionally separate from long-term garage component wear.
// Garage componentCondition answers "how worn is this car before/after a GP?";
// this module answers "what accident damage is this car carrying right now?".

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const COMPONENTS=["front_wing","floor","suspension","rear_wing","brakes","cooling"];

const COMPONENT_EFFECTS={
  front_wing:{aero:0.90,handling:0.30,braking:0.00,cooling:0.00,pace_s_at_100:0.90},
  floor:{aero:1.00,handling:0.45,braking:0.00,cooling:0.00,pace_s_at_100:1.15},
  suspension:{aero:0.10,handling:1.00,braking:0.30,cooling:0.00,pace_s_at_100:0.95},
  rear_wing:{aero:0.80,handling:0.45,braking:0.00,cooling:0.00,pace_s_at_100:0.75},
  brakes:{aero:0.00,handling:0.20,braking:1.00,cooling:0.00,pace_s_at_100:0.65},
  cooling:{aero:0.00,handling:0.00,braking:0.00,cooling:1.00,pace_s_at_100:0.20},
};

function band(value){
  const n=clamp(value);
  if(n>=85)return "critical";
  if(n>=60)return "major";
  if(n>=30)return "moderate";
  if(n>0)return "minor";
  return "none";
}

function weightedOrder(kind,rolls=[]){
  const key=String(kind||"accident").toLowerCase();
  const weights={
    collision:{front_wing:1.00,suspension:0.95,floor:0.72,rear_wing:0.55,cooling:0.46,brakes:0.40},
    accident:{suspension:1.00,floor:0.88,front_wing:0.82,rear_wing:0.68,cooling:0.54,brakes:0.48},
    aquaplaning_accident:{suspension:1.00,floor:0.90,front_wing:0.78,rear_wing:0.70,cooling:0.52,brakes:0.50},
    aquaplaning_loss_of_control:{floor:1.00,front_wing:0.72,suspension:0.66,rear_wing:0.42,cooling:0.20,brakes:0.20},
    aquaplaning_spin:{floor:1.00,front_wing:0.50,suspension:0.44,rear_wing:0.30,cooling:0.12,brakes:0.12},
  }[key]||{suspension:1.00,front_wing:0.85,floor:0.80,rear_wing:0.60,cooling:0.45,brakes:0.40};

  return COMPONENTS
    .map((component,index)=>{
      const jitter=0.82+0.36*clamp(Number(rolls[index]??0.5),0,1);
      return {component,weight:Number(weights[component]||0.25)*jitter};
    })
    .sort((a,b)=>b.weight-a.weight);
}

function baseImpact(severityScore){
  const s=Math.max(0,Math.min(1,Number(severityScore)||0));
  // Keeps low contact survivable while allowing genuinely heavy crashes.
  return clamp(4+92*Math.pow(s,1.18),0,100);
}

export function damageEffectsFromComponents(components={}){
  let aero=0,handling=0,braking=0,cooling=0,pace=0;
  for(const component of COMPONENTS){
    const damage=clamp(components?.[component]?.damage_pct??components?.[component]??0);
    const effect=COMPONENT_EFFECTS[component];
    const ratio=damage/100;
    aero+=ratio*effect.aero*100;
    handling+=ratio*effect.handling*100;
    braking+=ratio*effect.braking*100;
    cooling+=ratio*effect.cooling*100;
    pace+=ratio*effect.pace_s_at_100;
  }
  return {
    aero_loss_pct:Number(clamp(aero,0,100).toFixed(1)),
    handling_loss_pct:Number(clamp(handling,0,100).toFixed(1)),
    braking_loss_pct:Number(clamp(braking,0,100).toFixed(1)),
    cooling_damage_pct:Number(clamp(cooling,0,100).toFixed(1)),
    pace_loss_s_per_lap:Number(Math.min(3.5,Math.max(0,pace)).toFixed(3)),
  };
}

function normaliseComponents(raw={}){
  return Object.fromEntries(COMPONENTS.map((component)=>{
    const damage=clamp(raw?.[component]?.damage_pct??raw?.[component]??0);
    return [component,{
      damage_pct:Number(damage.toFixed(1)),
      severity:band(damage),
    }];
  }));
}

export function damageStateFromComponents(raw={},meta={}){
  const components=normaliseComponents(raw);
  const values=COMPONENTS.map((component)=>components[component].damage_pct);
  const damaged=COMPONENTS.filter((component)=>components[component].damage_pct>0);
  const maxDamage=values.length?Math.max(...values):0;
  const average=damaged.length
    ?damaged.reduce((sum,component)=>sum+components[component].damage_pct,0)/damaged.length
    :0;
  const effects=damageEffectsFromComponents(components);
  const structuralCritical=
    components.suspension.damage_pct>=88||
    components.brakes.damage_pct>=92||
    components.cooling.damage_pct>=96;
  const catastrophic=maxDamage>=96||(maxDamage>=90&&average>=72);
  return {
    model:"rw5.3a",
    source:String(meta?.source||"incident"),
    components,
    damaged_components:damaged,
    overall_damage_pct:Number((0.65*maxDamage+0.35*average).toFixed(1)),
    severity:band(0.65*maxDamage+0.35*average),
    max_component_damage_pct:Number(maxDamage.toFixed(1)),
    ...effects,
    structural_critical:Boolean(structuralCritical),
    catastrophic:Boolean(catastrophic),
    can_continue:!(structuralCritical||catastrophic),
  };
}

export function damageFromIncident({
  kind="accident",
  severityScore=0.5,
  componentRolls=[],
  impactRoll=0.5,
  retirementRoll=0.5,
}={}){
  const severity=Math.max(0,Math.min(1,Number(severityScore)||0));
  const key=String(kind||"accident").toLowerCase();
  const impact=baseImpact(severity)*(0.86+0.28*Math.max(0,Math.min(1,Number(impactRoll)||0.5)));
  const order=weightedOrder(key,componentRolls);
  const count=severity>=0.94?5:severity>=0.78?4:severity>=0.50?3:severity>=0.22?2:1;
  const raw={};

  order.slice(0,count).forEach(({component,weight},index)=>{
    const falloff=[1.00,0.72,0.52,0.38,0.28,0.20][index]||0.18;
    raw[component]=clamp(impact*falloff*Math.max(0.55,weight),0,100);
  });

  // Spins/loss-of-control frequently escape with no meaningful contact.
  if(key.includes("spin")&&severity<0.50&&Number(impactRoll)<0.42)return null;
  if(key.includes("loss_of_control")&&severity<0.35&&Number(impactRoll)<0.30)return null;

  const state=damageStateFromComponents(raw,{source:key});
  const retirementProbability=state.structural_critical||state.catastrophic
    ?0.98
    :state.severity==="critical"
      ?0.72
      :state.severity==="major"
        ?0.30
        :state.severity==="moderate"
          ?0.08
          :0.015;
  const retired=Number(retirementRoll)<retirementProbability;

  return {
    ...state,
    retirement_probability:Number(retirementProbability.toFixed(3)),
    retirement_required:Boolean(retired),
  };
}

export function mergeDamageStates(states=[]){
  const relevant=(states||[]).filter(Boolean);
  if(!relevant.length)return damageStateFromComponents({},{source:"none"});
  const merged={};
  for(const component of COMPONENTS){
    let survival=1;
    for(const state of relevant){
      const d=clamp(state?.components?.[component]?.damage_pct??0)/100;
      survival*=1-d;
    }
    merged[component]=(1-survival)*100;
  }
  return damageStateFromComponents(merged,{source:"cumulative"});
}

export function incidentDamageStateThrough(incidents=[],driverId,throughOrdinal=Infinity){
  const did=String(driverId??"");
  return mergeDamageStates(
    (incidents||[])
      .filter((incident)=>String(incident?.driver_id??"")===did)
      .filter((incident)=>Number(incident?.damage_ordinal??0)<=Number(throughOrdinal))
      .map((incident)=>incident?.damage)
      .filter(Boolean)
  );
}

export function damagePenaltyMsBetweenOrdinals(incidents=[],driverId,fromOrdinal,toOrdinal){
  const start=Number(fromOrdinal)||0;
  const end=Number(toOrdinal)||0;
  if(end<=start)return 0;
  const did=String(driverId??"");
  const relevant=(incidents||[])
    .filter((incident)=>String(incident?.driver_id??"")===did&&incident?.damage)
    .map((incident)=>({
      ...incident,
      ordinal:Number(incident?.damage_ordinal??0),
    }))
    .sort((a,b)=>a.ordinal-b.ordinal);

  const active=[];
  for(const incident of relevant){
    if(incident.ordinal<=start)active.push(incident.damage);
  }

  let cursor=start;
  let total=0;
  const addSegment=(segmentEnd)=>{
    if(segmentEnd<=cursor)return;
    const pace=active.length
      ?Math.max(0,Number(mergeDamageStates(active).pace_loss_s_per_lap)||0)
      :0;
    total+=((segmentEnd-cursor)/3)*1000*pace;
    cursor=segmentEnd;
  };

  for(const incident of relevant){
    if(incident.ordinal<=start)continue;
    if(incident.ordinal>=end)break;
    addSegment(incident.ordinal);
    active.push(incident.damage);
  }
  addSegment(end);
  return total;
}

export function damagePenaltyMsThroughOrdinal(incidents=[],driverId,throughOrdinal){
  return damagePenaltyMsBetweenOrdinals(incidents,driverId,0,throughOrdinal);
}

export const CAR_DAMAGE_COMPONENTS=Object.freeze([...COMPONENTS]);
