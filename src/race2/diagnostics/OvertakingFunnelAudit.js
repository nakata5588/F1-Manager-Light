// RW38-A: read-only event-based overtaking funnel diagnostic.
// Does not alter race physics, RNG or canonical classification.
const finite=(v)=>Number.isFinite(Number(v))?Number(v):null;
const round=(v)=>v==null?null:Math.round(v*1000)/1000;
const percent=(n,d)=>d?round(100*n/d):null;

export function diagnoseOvertakingEvents(events=[]){
  const attempts=new Map();
  const orphanOutcomes=[];
  for(const event of events||[]){
    const type=String(event?.type||"");
    if(!["overtake_started","overtake_side_by_side","overtake_completed","overtake_failed","overtake_aborted","contact"].includes(type))continue;
    const payload=event?.payload||{};
    const id=payload.attemptId==null?null:String(payload.attemptId);
    if(type==="overtake_started"){
      if(!id)continue;
      const factors=payload.opportunityContributions||{};
      attempts.set(id,{
        id, startedAtMs:finite(event.timeMs), outcome:"unresolved",
        reason:null, durationMs:null, reachedSideBySide:false, sideBySideAtMs:null, finalGapM:null, lastClosingMs:null, initialGapM:finite(payload.gapM),
        closingPotentialMs:finite(payload.closingPotentialMs),
        probability:finite(payload.probability),
        tyreConditionEdge:finite(payload.tyreConditionEdge),
        tyreGripEdge:finite(payload.tyreGripEdge),
        damageEdge:finite(payload.damageEdge),
        performanceEdge:finite(payload.performanceEdge),
        strategyEdge:finite(payload.strategyEdge),
        towStrength:finite(payload.towStrength),
        trackPhase:payload.trackPhase??null,
        contributions:factors,
      });
      continue;
    }
    if(type==="overtake_side_by_side"){
      const item=id?attempts.get(id):null;
      if(!item){orphanOutcomes.push({type,id});continue;}
      item.reachedSideBySide=true;
      item.sideBySideAtMs=finite(event.timeMs);
      item.finalGapM=finite(payload.gapM);
      item.lastClosingMs=finite(payload.actualClosingMs);
      continue;
    }
    const outcome=type==="overtake_completed"?"completed":type==="overtake_failed"?"failed":type==="overtake_aborted"?"aborted":"contact";
    const item=id?attempts.get(id):null;
    if(!item){orphanOutcomes.push({type,id});continue;}
    if(item.outcome!=="unresolved")continue;
    item.outcome=outcome;
    item.reason=payload.reason??null;
    if(payload.finalGapM!=null)item.finalGapM=finite(payload.finalGapM);
    if(payload.actualClosingMs!=null)item.lastClosingMs=finite(payload.actualClosingMs);
    item.durationMs=item.startedAtMs==null||finite(event.timeMs)==null?null:round(Math.max(0,Number(event.timeMs)-item.startedAtMs));
  }
  const rows=[...attempts.values()];
  const byOutcome={completed:0,failed:0,aborted:0,contact:0,unresolved:0};
  const failureReasons={};
  for(const item of rows){
    byOutcome[item.outcome]++;
    if(item.outcome==="failed"||item.outcome==="aborted"){
      const reason=item.reason||"unknown";
      failureReasons[reason]=(failureReasons[reason]||0)+1;
    }
  }
  const average=(key,subset=rows)=>{
    const values=subset.map(row=>row[key]).filter(v=>v!=null);
    return values.length?round(values.reduce((sum,v)=>sum+v,0)/values.length):null;
  };
  const completed=rows.filter(row=>row.outcome==="completed");
  const failed=rows.filter(row=>row.outcome==="failed");
  return {
    attempts:rows.length,byOutcome,failureReasons,orphanOutcomeCount:orphanOutcomes.length,
    completionRatePct:percent(byOutcome.completed,rows.length),
    failureRatePct:percent(byOutcome.failed,rows.length),
    averageInitialGapM:average("initialGapM"),
    averageClosingPotentialMs:average("closingPotentialMs"),
    averageDurationMs:average("durationMs"),
    completedAverageDurationMs:average("durationMs",completed),
    failedAverageDurationMs:average("durationMs",failed),
    sideBySideCount:rows.filter(r=>r.reachedSideBySide).length,
    failedBeforeSideBySide:rows.filter(r=>r.outcome==="failed"&&!r.reachedSideBySide).length,
    averageFailedFinalGapM:average("finalGapM",failed),
    averageFailedLastClosingMs:average("lastClosingMs",failed),
    note:"Pre-attempt gate rejections are not present in the event stream. Actual closing is only sampled at side-by-side transitions and approach failures.",
    attemptsByTrackPhase:Object.fromEntries([...new Set(rows.map(r=>r.trackPhase||"unknown"))].sort().map(phase=>[phase,rows.filter(r=>(r.trackPhase||"unknown")===phase).length])),
    samples:rows.slice(0,50),
  };
}
