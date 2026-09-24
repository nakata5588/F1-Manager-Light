import { managerGameplayEffects } from "./managerProfile.js";

const clamp01=(x)=>Math.max(0,Math.min(1,Number(x)||0));

export const BOARD_EXPECTATION_LABEL=Object.freeze({
  survive:"Survive / establish the team",
  points:"Score points",
  midfield:"Competitive midfield",
  podiums:"Fight for podiums",
  race_wins:"Win races",
  championship:"Challenge for the championship",
});

export function normalizeBoardExpectation(raw){
  const s=String(raw||"").toLowerCase();
  if(/championship|title/.test(s))return "championship";
  if(/race[_ ]?wins?|win one|wins?/.test(s))return "race_wins";
  if(/podium/.test(s))return "podiums";
  if(/midfield|mid-table|top 5|top5|top 6|top6/.test(s))return "midfield";
  if(/points?/.test(s))return "points";
  if(/survive|debut|qualify|stay in|avoid last/.test(s))return "survive";
  return "midfield";
}

export function boardMetrics(gs,teamId){
  const year=Number(gs?.activeYear);
  const events=(gs?.results||[]).filter((r)=>Number(r?.year)===year);
  let wins=0,podiums=0,points=0;
  for(const event of events){
    for(const row of event?.classification||[]){
      if(String(row?.team_id||"")!==String(teamId))continue;
      const p=Number(row?.position);
      points+=Number(row?.points||0);
      if(!row?.retired&&p===1)wins++;
      if(!row?.retired&&p>=1&&p<=3)podiums++;
    }
  }
  const standings=gs?.standings?.teams||gs?.standings?.constructors||[];
  const standing=standings.find((r)=>String(r?.team_id??r?.constructor_id??"")===String(teamId));
  return {
    races:events.length,
    totalRaces:Math.max(1,(gs?.calendar||[]).length||1),
    wins,podiums,points,
    constructorPosition:Number(standing?.position||0)||null,
    totalTeams:Math.max(1,(gs?.teams||[]).length||1),
  };
}

export function makeBoardObjectives(expectation,metrics){
  const maxPos=Math.max(1,metrics?.totalTeams||12);
  let rows=[];
  if(expectation==="championship")rows=[
    {id:"constructors",type:"constructor_position",target:2,title:"Championship challenge",desc:"Finish P2 or better in the Constructors' Championship.",weight:1.35,priority:1},
    {id:"wins",type:"wins",target:2,title:"Win races",desc:"Win at least 2 Grands Prix.",weight:1.10,priority:1},
    {id:"podiums",type:"podiums",target:6,title:"Regular podiums",desc:"Achieve at least 6 podium finishes.",weight:0.85,priority:2},
  ];
  else if(expectation==="race_wins")rows=[
    {id:"constructors",type:"constructor_position",target:4,title:"Leading group",desc:"Finish P4 or better in the Constructors' Championship.",weight:1.15,priority:1},
    {id:"wins",type:"wins",target:1,title:"Win a Grand Prix",desc:"Take at least one victory.",weight:1.10,priority:1},
    {id:"podiums",type:"podiums",target:3,title:"Fight for podiums",desc:"Achieve at least 3 podium finishes.",weight:0.80,priority:2},
  ];
  else if(expectation==="podiums")rows=[
    {id:"constructors",type:"constructor_position",target:Math.min(5,maxPos),title:"Upper midfield finish",desc:"Finish P5 or better in the Constructors' Championship.",weight:1.05,priority:1},
    {id:"podiums",type:"podiums",target:2,title:"Reach the podium",desc:"Achieve at least 2 podium finishes.",weight:1.00,priority:1},
    {id:"points",type:"points",target:15,title:"Score consistently",desc:"Score at least 15 championship points.",weight:0.75,priority:2},
  ];
  else if(expectation==="points")rows=[
    {id:"constructors",type:"constructor_position",target:Math.min(8,maxPos),title:"Avoid the back",desc:"Finish P8 or better in the Constructors' Championship.",weight:1.00,priority:1},
    {id:"points",type:"points",target:10,title:"Score points",desc:"Score at least 10 championship points.",weight:1.00,priority:1},
  ];
  else if(expectation==="midfield")rows=[
    {id:"constructors",type:"constructor_position",target:Math.min(7,maxPos),title:"Competitive midfield",desc:"Finish P7 or better in the Constructors' Championship.",weight:1.05,priority:1},
    {id:"points",type:"points",target:6,title:"Regular points challenge",desc:"Score at least 6 championship points.",weight:0.95,priority:1},
  ];
  else rows=[
    {id:"constructors",type:"constructor_position",target:Math.min(10,maxPos),title:"Establish the team",desc:"Finish P"+Math.min(10,maxPos)+" or better in the Constructors' Championship.",weight:1.00,priority:1},
    {id:"points",type:"points",target:1,title:"Score a point",desc:"Score at least one championship point.",weight:0.90,priority:2},
  ];

  return rows.map((o)=>{
    let progress=0;
    if(o.type==="constructor_position"){
      progress=metrics?.constructorPosition
        ?(metrics.constructorPosition<=o.target?1:clamp01(o.target/metrics.constructorPosition))
        :0;
    }else{
      progress=clamp01(Number(metrics?.[o.type]||0)/Math.max(1,o.target));
    }
    return {...o,category:"PERFORMANCE",progress,status:progress>=1?"completed":"active",deadline:"Season end"};
  });
}

export function deriveBoardState(gs){
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const brand=(gs?.teamBrands||[]).find((b)=>String(b?.team_id??"")===teamId)||{};
  const stored=gs?.board&&typeof gs.board==="object"?gs.board:{};
  const expectation=normalizeBoardExpectation(
    stored?.profile_version===2
      ? stored?.expectation
      : (stored?.expectation??stored?.season_expectation??brand?.board_expectation??"midfield")
  );
  const metrics=boardMetrics(gs,teamId);
  const objectives=makeBoardObjectives(expectation,metrics);
  const reputation=clamp01(stored?.reputation??stored?.rep??stored?.board_reputation??0.5);
  const sumW=objectives.reduce((s,o)=>s+Number(o.weight||1),0)||1;
  const objectiveScore=objectives.length
    ?objectives.reduce((s,o)=>s+clamp01(o.progress)*Number(o.weight||1),0)/sumW
    :0.5;
  const managerEffects=managerGameplayEffects(gs,{teamId});
  const confidence=clamp01(reputation*0.45+objectiveScore*0.55+managerEffects.boardConfidenceDelta);
  return {
    ...stored,
    profile_version:2,
    expectation,
    expectationLabel:BOARD_EXPECTATION_LABEL[expectation]||"Competitive season",
    reputation,
    confidence,
    managerConfidenceDelta:managerEffects.boardConfidenceDelta,
    objectiveScore,
    metrics,
    objectives,
    actions:Array.isArray(stored.actions)?stored.actions:[],
  };
}
