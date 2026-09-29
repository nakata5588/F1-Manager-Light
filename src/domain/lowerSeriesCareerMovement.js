// src/domain/lowerSeriesCareerMovement.js
//
// LS7 — season-to-season Lower Series career movement.
//
// Movement is derived only from the completed Save-World championship:
// standings, public prospect reputation and the level already being raced.
// It never consults the historical future career or hidden Potential Ability.

export const LOWER_SERIES_MOVEMENT_MODEL="lower_series_career_movement_v1";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;
const driverIdOf=(row)=>text(row?.driver_id??row?.person_id??row?.id);

function standingFor(world,entry,driverId){
  const seriesId=text(entry?.series_id);
  const championship=world?.standings?.[seriesId]||null;
  const standing=rows(championship?.drivers)
    .find((row)=>driverIdOf(row)===driverId)||null;
  return {championship,standing};
}

function placementScore(standing,championship){
  const field=Math.max(1,rows(championship?.drivers).length);
  const position=num(standing?.position,null);
  if(!Number.isFinite(position))return 0;
  if(field<=1)return position===1?100:0;
  return clamp((field-position)/(field-1)*100,0,100);
}

export function lowerSeriesCareerMovement(world,driver,entry,{
  targetYear=null,
}={}){
  const driverId=driverIdOf(entry)||driverIdOf(driver);
  const fromLevel=clamp(num(entry?.series_level,5),2,5);
  const prospect=world?.prospects?.[driverId]||null;
  const {championship,standing}=standingFor(world,entry,driverId);
  const starts=Math.max(0,num(standing?.starts,0));
  const performance=clamp(num(prospect?.performance?.score,0),0,100);
  const reputation=clamp(num(prospect?.prospect_reputation,0),0,100);
  const placement=placementScore(standing,championship);
  const champion=Boolean(
    championship?.complete&&
    text(championship?.champion_driver_id)===driverId
  );

  const score=round1(clamp(
    performance*0.50+
    reputation*0.35+
    placement*0.15+
    (champion?8:0),
    0,
    100
  ));

  const enoughEvidence=starts>=3&&championship?.complete===true;
  let decision="stay";
  let targetLevel=fromLevel;
  let f1Ready=false;
  let reason="insufficient_season_signal";

  if(enoughEvidence&&fromLevel===2){
    f1Ready=champion||score>=70||(
      num(standing?.position,999)<=3&&reputation>=68
    );
    decision=f1Ready?"f1_ready":"stay";
    reason=f1Ready
      ?(champion?"top_level_champion":"top_level_performance")
      :"top_level_not_ready";
  }else if(enoughEvidence&&fromLevel>2){
    const position=num(standing?.position,999);
    const promotion=
      champion||
      score>=64||
      (position<=3&&reputation>=55&&performance>=55);
    if(promotion){
      decision="promote";
      targetLevel=Math.max(2,fromLevel-1);
      reason=champion?"champion_promotion":"performance_promotion";
    }else{
      reason="performance_stay";
    }
  }

  return {
    model:LOWER_SERIES_MOVEMENT_MODEL,
    driver_id:driverId,
    from_series_id:text(entry?.series_id)||null,
    from_level:fromLevel,
    target_level:targetLevel,
    decision,
    f1_ready:f1Ready,
    movement_score:score,
    starts,
    championship_position:num(standing?.position,null),
    champion,
    prospect_reputation:round1(reputation),
    performance_score:round1(performance),
    target_year:Number.isInteger(Number(targetYear))?Number(targetYear):null,
    reason,
    source:"lower_series_save_world_results",
  };
}

export function lowerSeriesMovementLabel(movement){
  if(!movement)return "No movement";
  if(movement.effective_outcome==="promoted")return "Promoted";
  if(movement.effective_outcome==="promotion_pending")return "Promotion pending";
  if(movement.effective_outcome==="promotion_blocked")return "Promotion blocked";
  if(movement.f1_ready||movement.effective_outcome==="f1_ready")return "F1 Ready";
  if(movement.decision==="promote")return "Promotion candidate";
  return "Stays in category";
}
