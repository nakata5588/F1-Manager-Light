// Historical car baseline for the START of a newly selected season only.
// Input rows must already have a verified managerial team_id / entrant mapping.
// Do not call this for a simulated next season; driver materialization is separate.
const number=(v,f=null)=>v==null||v===""?f:Number.isFinite(Number(v))?Number(v):f;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const mean=(a)=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const id=(v)=>String(v??"").trim();
const statusOf=(r)=>id(r?.status??r?.statusId??r?.status_text).toLowerCase();
const finishPosition=(r)=>number(r?.positionOrder??r?.position_order??r?.position,null);
const gridPosition=(r)=>number(r?.grid??r?.grid_position,null);
const isClassified=(r)=>r?.classified===true||/^(finished|classified|\+\d+ laps?)$/i.test(statusOf(r));
const mechanical=(r)=>r?.retirement_category==="mechanical"||/engine|gearbox|transmission|hydraulic|electrical|suspension|brake|mechanical|oil|clutch|fuel|overheat/i.test(statusOf(r));
const isDnq=(r)=>/dnq|dnpq|did not qualify|did not prequalify/i.test(statusOf(r))||r?.qualified===false;
const isAccident=(r)=>/accident|collision|spin|crash/i.test(statusOf(r))||r?.retirement_category==="accident";
const round1=(n)=>Number(n.toFixed(1));

/** Infer initial technical competitiveness from recorded outcomes, not driver ratings.
 * Each driver is first averaged per season, then each driver contributes equally
 * to the team. The algorithm never overwrites an explicit year-specific car stat.
 * Ambiguous result rows are excluded, rather than guessing constructor=entrant.
 */
export function materializeHistoricalCarBaselines(results,year,{teamIds=[]}={}){
  const target=Number(year);
  const selected=(results||[]).filter(r=>
    number(r?.year??r?.season_year,null)===target&&id(r?.team_id)&&
    id(r?.driver_id??r?.driverId)
  );
  const raceField=new Map();
  for(const r of selected){
    const race=id(r?.raceId??r?.race_id??r?.round);
    if(!race)continue;
    const key=race;
    const field=raceField.get(key)||new Set();
    field.add(id(r?.driver_id??r?.driverId));
    raceField.set(key,field);
  }
  const byTeam=new Map();
  for(const r of selected){
    const team=id(r.team_id),driver=id(r.driver_id??r.driverId);
    if(teamIds.length&&!teamIds.map(id).includes(team))continue;
    const race=id(r?.raceId??r?.race_id??r?.round);
    const field=Math.max(2,raceField.get(race)?.size??number(r?.field_size,20)??20);
    const pos=finishPosition(r),grid=gridPosition(r),dnq=isDnq(r);
    const pts=number(r?.points,0);
    const finish=pos!=null&&pos>0?clamp(1-(pos-1)/(field-1),0,1):0;
    const qualifying=grid!=null&&grid>0?clamp(1-(grid-1)/(field-1),0,1):null;
    const podium=pos!=null&&pos<=3&&isClassified(r);
    const win=pos===1&&isClassified(r);
    // Normalized, bounded contributions; no automatic driver skill subtraction:
    // with results alone we measure observed team outcomes, not pure car quality.
    const pace=clamp(finish*0.55+(qualifying??finish)*0.30+
      Math.min(1,pts/10)*0.10+(podium?0.03:0)+(win?0.02:0)-
      (dnq?0.24:0),0,1);
    const row={
      pace,
      qualifying:qualifying??(dnq?0:finish),
      mechanical:mechanical(r)?1:0,
      accident:isAccident(r)?1:0,
      dnq:dnq?1:0,
      classified:isClassified(r)?1:0,
    };
    if(!byTeam.has(team))byTeam.set(team,new Map());
    const byDriver=byTeam.get(team);
    if(!byDriver.has(driver))byDriver.set(driver,[]);
    byDriver.get(driver).push(row);
  }
  const rows=[];
  for(const [team,drivers] of byTeam){
    const avgDrivers=[...drivers.values()].map(items=>({
      pace:mean(items.map(x=>x.pace)),
      qualifying:mean(items.map(x=>x.qualifying)),
      mechanical:mean(items.map(x=>x.mechanical)),
      dnq:mean(items.map(x=>x.dnq)),
      races:items.length,
    }));
    const pace=mean(avgDrivers.map(x=>x.pace));
    const qualifying=mean(avgDrivers.map(x=>x.qualifying));
    const mechanicalRate=mean(avgDrivers.map(x=>x.mechanical));
    const dnqRate=mean(avgDrivers.map(x=>x.dnq));
    // Bounded initial strength; not a fabricated engine/chassis part specification.
    const race=round1(clamp(42+pace*54,40,96));
    const q=round1(clamp(42+qualifying*54,40,96));
    const reliability=round1(clamp(96-mechanicalRate*48,45,96));
    rows.push({
      year:target,team_id:team,race,qualifying:q,reliability,
      historical_result_strength:round1(pace*100),
      historical_mechanical_dnf_rate:round1(mechanicalRate*100),
      historical_dnq_rate:round1(dnqRate*100),
      evidence_driver_count:avgDrivers.length,
      evidence_result_count:avgDrivers.reduce((n,r)=>n+r.races,0),
      source:"same_season_results_baseline_v1",
      confidence:avgDrivers.length>=2&&avgDrivers.reduce((n,r)=>n+r.races,0)>=12?"medium":"low",
    });
  }
  return rows.sort((a,b)=>b.race-a.race||a.team_id.localeCompare(b.team_id));
}
