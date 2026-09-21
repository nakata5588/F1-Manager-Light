// src/engine/ProgressionEngine.js
import {
  defaultDriverCondition,
  normalizeDriverCondition,
  ensureAbilityAnchor,
  recalculateCurrentAbility,
} from "../domain/driverRating.js";
import { currentDriverTeamId } from "../domain/driverContracts.js";

function clamp(n,a=0,b=100){return Math.max(a,Math.min(b,Number(n)||0));}
function today(gs){return String(gs?.currentDateISO||"").slice(0,10);}
function idOf(o){return String(o?.driver_id??o?.person_id??o?.id??"");}
function pick(o,keys,fb=undefined){
  for(const k of keys){
    const v=o?.[k];
    const u=v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
    if(u!==undefined&&u!==null&&u!=="")return u;
  }
  return fb;
}
function birthYear(driver){
  const raw=String(pick(driver,["dob","birthdate","date_of_birth"],""));
  const m=raw.match(/^(\d{4})/);
  return m?Number(m[1]):NaN;
}
function ageOf(driver,year){
  const explicit=Number(driver?.age);
  if(Number.isFinite(explicit))return explicit;
  const born=birthYear(driver);
  return Number.isFinite(born)?Math.max(0,Number(year)-born):28;
}
function simpleHash(text){
  let h=2166136261;
  for(const ch of String(text||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return Math.abs(h>>>0);
}
function meanRevert(value,target=50,rate=0.025){
  const v=Number(value);
  if(!Number.isFinite(v))return target;
  return clamp(v+(target-v)*rate);
}
function resolveDriverTeamId(gs,driverId){
  return currentDriverTeamId(gs,driverId);
}
function simulatorLevel(gs,teamId){
  const userTeam=String(gs?.team?.team_id??gs?.team?.id??"");
  if(teamId&&teamId===userTeam){
    const override=Number(gs?.hq?.facilityLevels?.simulator_level);
    if(Number.isFinite(override))return override;
  }
  const year=Number(gs?.activeYear);
  const row=(gs?.facilities||[]).find((r)=>
    String(pick(r,["team_id","team"],""))===String(teamId) &&
    (!Number.isFinite(Number(pick(r,["year","season_year"],year)))||Number(pick(r,["year","season_year"],year))===year)
  );
  const level=Number(pick(row||{},["simulator_level"],5));
  return Number.isFinite(level)?level:5;
}
function seasonForm(gs,driverId){
  const year=Number(gs?.activeYear);
  let starts=0,wins=0,podiums=0,dnfs=0,points=0,finishSum=0,finishCount=0;
  for(const event of gs?.results||[]){
    if(Number(event?.year)!==year)continue;
    const row=(event?.classification||[]).find((r)=>String(r?.driver_id??"")===String(driverId));
    if(!row)continue;
    starts++;
    points+=Number(row.points||0);
    const pos=Number(row.position);
    if(Number.isFinite(pos)){finishSum+=pos;finishCount++;}
    if(row.retired)dnfs++;
    else if(pos===1)wins++;
    if(!row.retired&&pos>=1&&pos<=3)podiums++;
  }
  return {
    starts,wins,podiums,dnfs,points,
    avgFinish:finishCount?finishSum/finishCount:null,
  };
}
function ageCurve(age){
  if(age<=19)return 0.20;
  if(age<=22)return 0.16;
  if(age<=25)return 0.10;
  if(age<=29)return 0.045;
  if(age<=32)return 0.015;
  if(age<=35)return -0.025;
  if(age<=38)return -0.060;
  return -0.10;
}
const GROWTH_ATTRS=[
  "pace","qualifying","racecraft","consistency","tire_management",
  "race_intelligence","pressure_handling","adaptability","mentality","technical_feedback",
];
const DECLINE_ATTRS=["pace","qualifying","start_launch","adaptability","consistency"];
const ATTRIBUTE_MULTIPLIER={
  pace:1.00,qualifying:0.90,racecraft:0.90,consistency:0.80,tire_management:0.65,
  race_intelligence:0.70,pressure_handling:0.55,adaptability:0.60,mentality:0.55,
  technical_feedback:0.50,start_launch:0.85,
};

function applyDelta(rating,key,delta,changes,driverId,dateISO,source){
  if(!Number.isFinite(Number(rating?.[key]))||!Number.isFinite(Number(delta))||Math.abs(delta)<0.001)return;
  const before=Number(rating[key]);
  const after=Math.round(clamp(before+delta)*100)/100;
  if(after===before)return;
  rating[key]=after;
  changes.push({dateISO,driverId,attr:key,before,after,delta:after-before,source});
}

function monthlyProgression(gs,ratings,dateISO){
  const year=Number(gs?.activeYear);
  const monthKey=dateISO.slice(0,7);
  const driversById=new Map((gs?.drivers||[]).map((d)=>[idOf(d),d]));
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const changes=[];
  const nextRatings=(ratings||[]).map((raw)=>{
    const did=idOf(raw);
    const driver=driversById.get(did);
    if(!driver)return raw;

    let rating=ensureAbilityAnchor({...raw});
    const age=ageOf(driver,year);
    const current=Number(rating.current_ability||0);
    const potential=Number(rating.potential_ability);
    const gap=Number.isFinite(potential)?Math.max(0,potential-current):10;
    const teamId=resolveDriverTeamId(gs,did);
    const sim=simulatorLevel(gs,teamId);
    const form=seasonForm(gs,did);
    const curve=ageCurve(age);
    const facilityFactor=0.80+Math.max(0,Math.min(10,sim))*0.035;

    if(curve>=0){
      const potentialFactor=Math.max(0.15,Math.min(1.35,gap/12||0.15));
      const base=curve*facilityFactor*potentialFactor;
      const offset=simpleHash(`${monthKey}:${did}:growth`)%GROWTH_ATTRS.length;
      for(let i=0;i<3;i++){
        const key=GROWTH_ATTRS[(offset+i*3)%GROWTH_ATTRS.length];
        applyDelta(rating,key,base*(ATTRIBUTE_MULTIPLIER[key]||0.6),changes,did,dateISO,"natural_development");
      }
    }else{
      const base=Math.abs(curve);
      for(const key of DECLINE_ATTRS){
        applyDelta(rating,key,-base*(ATTRIBUTE_MULTIPLIER[key]||0.7),changes,did,dateISO,"age_regression");
      }
    }

    // Experience can still improve judgement after raw pace has plateaued.
    if(form.starts>0){
      const experience=Math.min(0.07,0.012+form.starts*0.002);
      applyDelta(rating,"race_intelligence",experience,changes,did,dateISO,"race_experience");
      applyDelta(rating,"consistency",experience*0.65,changes,did,dateISO,"race_experience");
      applyDelta(rating,"technical_feedback",experience*0.45,changes,did,dateISO,"race_experience");
    }
    if(form.wins>0||form.podiums>0){
      const success=Math.min(0.08,form.wins*0.025+form.podiums*0.008);
      applyDelta(rating,"pressure_handling",success,changes,did,dateISO,"competitive_success");
      applyDelta(rating,"mentality",success*0.7,changes,did,dateISO,"competitive_success");
    }
    if(form.dnfs>=2){
      const setback=Math.min(0.10,form.dnfs*0.018);
      applyDelta(rating,"mentality",-setback,changes,did,dateISO,"reliability_setback");
      applyDelta(rating,"consistency",-setback*0.55,changes,did,dateISO,"reliability_setback");
    }

    // AI-controlled teams perform a modest automatic monthly training session.
    // Player drivers can exceed this through explicit Actions.
    if(teamId && teamId!==userTeamId){
      const candidates=["pace","qualifying","racecraft","consistency","tire_management"];
      const weakest=candidates
        .filter((k)=>Number.isFinite(Number(rating[k])))
        .sort((a,b)=>Number(rating[a])-Number(rating[b])||a.localeCompare(b))[0];
      if(weakest){
        const autoGain=(0.055+Math.max(0,Math.min(10,sim))*0.006)*(age<=32?1:0.55);
        applyDelta(rating,weakest,autoGain,changes,did,dateISO,"ai_training");
      }
    }

    rating=recalculateCurrentAbility(rating);
    return rating;
  });

  return {ratings:nextRatings,changes,monthKey};
}

export function applyProgressionTick(gs){
  const next={...gs};
  const dateISO=today(gs);
  if(!dateISO)return next;

  const dict={...(gs.driverAttributes||{})};
  for(const d of gs.drivers||[]){
    const id=idOf(d);
    if(!id)continue;
    const curr=normalizeDriverCondition(dict[id]||defaultDriverCondition());
    const dow=new Date(`${dateISO}T00:00:00Z`).getUTCDay();
    const recovery=(dow===0||dow===6)?2.5:1.5;
    dict[id]={
      ...curr,
      fatigue:clamp(curr.fatigue-recovery),
      preparation:clamp(curr.preparation+(curr.preparation<60?0.20:0)),
      confidence:meanRevert(curr.confidence,50,0.018),
      morale:meanRevert(curr.morale,50,0.010),
    };
  }
  next.driverAttributes=dict;

  const monthKey=dateISO.slice(0,7);
  if(gs?._lastDriverProgressionMonth===monthKey)return next;

  const {ratings,changes}=monthlyProgression(next,gs.driverRatings||[],dateISO);
  next.driverRatings=ratings;
  next._lastDriverProgressionMonth=monthKey;

  if(changes.length){
    const log={...(gs.driverAttrLog||{})};
    for(const ch of changes){
      const digits=String(ch.driverId||"").match(/(\d+)/)?.[1]?.padStart(4,"0")||String(ch.driverId||"");
      log[digits]=[...(log[digits]||[]),ch].slice(-200);
    }
    next.driverAttrLog=log;
  }

  return next;
}
