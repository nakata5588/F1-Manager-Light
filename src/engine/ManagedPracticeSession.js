// Incremental Practice scheduler: pure, serializable and independent of React.
// Outcomes are supplied by the canonical practice simulation, never fabricated here.
export const PRACTICE_SESSION_MINUTES = 60; // provisional gameplay default; historical rules can override
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,Number(v)||0));
export function managedPracticeState(weekend,minutes=PRACTICE_SESSION_MINUTES){
  return weekend?.managed_practice || {version:1,duration_minutes:minutes,elapsed_minutes:0,stints:[],repairs:{},finished:false};
}
export function canRunPracticeStint(state,driverId,minutes){
  const duration=Number(minutes);
  return Boolean(driverId)&&Number.isFinite(duration)&&duration>0&&!state.finished&&
    !state.repairs?.[driverId]&&state.elapsed_minutes+duration<=state.duration_minutes;
}
export function appendPracticeStint(state,{driverId,programmeId,minutes,outcome}){
  if(!canRunPracticeStint(state,driverId,minutes))return state;
  const elapsed=state.elapsed_minutes+Number(minutes);
  const stint={id:`stint-${state.stints.length+1}`,driver_id:String(driverId),
    programme_id:String(programmeId),duration_minutes:Number(minutes),
    start_minute:state.elapsed_minutes,end_minute:elapsed,outcome:outcome||null};
  return {...state,elapsed_minutes:elapsed,stints:[...state.stints,stint]};
}
export function repairPracticeCar(state,{driverId,minutes}){
  const required=clamp(minutes,1,state.duration_minutes);
  if(!state.repairs?.[driverId]||state.finished)return state;
  if(state.elapsed_minutes+required>state.duration_minutes)return state;
  const elapsed=state.elapsed_minutes+required;
  return {...state,elapsed_minutes:elapsed,repairs:{...state.repairs,[driverId]:null}};
}
export function markPracticeDamage(state,driverId,reason){
  return {...state,repairs:{...state.repairs,[driverId]:String(reason||"Inspection required")}};
}

export function managedPracticeSummary(state,driverId){
  const stints=(state?.stints||[]).filter(row=>String(row.driver_id)===String(driverId));
  return {stints:stints.length,minutes:stints.reduce((sum,row)=>sum+Number(row.duration_minutes||0),0),
    issues:stints.filter(row=>row.outcome?.issue_type).length,
    lastOutcome:stints.at(-1)?.outcome||null};
}

/** One authoritative minute of shared session time. Idling burns time but
 * creates no false driver outcome. This remains deterministic after restore. */
export function advancePracticeClock(state,minutes=1){
  const delta=Number(minutes);
  if(!Number.isFinite(delta)||delta<=0||state.finished)return state;
  const elapsed=Math.min(Number(state.duration_minutes),Number(state.elapsed_minutes)+delta);
  if(elapsed===state.elapsed_minutes)return state;
  return {...state,elapsed_minutes:elapsed};
}
