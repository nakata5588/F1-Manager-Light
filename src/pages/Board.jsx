import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { TeamLogo } from "@/components/entity/EntityVisuals.jsx";

const DAY = 86_400_000;
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const pct = (x) => `${Math.round(clamp01(x) * 100)}%`;
const titleCase = (s) => String(s || "").replace(/_/g," ").replace(/\b\w/g,(m)=>m.toUpperCase());
const fmtMoney = (n) => new Intl.NumberFormat("en-GB", {
  style:"currency", currency:"USD", maximumFractionDigits:0,
}).format(Number(n || 0));

function parseISO(value) {
  const [y,m,d] = String(value || "").slice(0,10).split("-").map(Number);
  return new Date(Date.UTC(y || 1970,(m || 1)-1,d || 1));
}
function daysBetween(a,b) {
  return Math.floor((+parseISO(b) - +parseISO(a)) / DAY);
}
function normalizeBoard(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const objectives = (
    Array.isArray(src.objectives) ? src.objectives :
    Array.isArray(src.goals) ? src.goals : []
  ).map((o,i)=>({
    ...o,
    id:o.id ?? `OBJ_${i}`,
    category:String(o.category ?? o.type ?? "OTHER").toUpperCase(),
    title:o.title ?? o.name ?? "Objective",
    desc:o.desc ?? o.description ?? "",
    status:String(o.status ?? "active").toLowerCase(),
    progress:clamp01(o.progress ?? (o.done ? 1 : 0)),
    weight:Number(o.weight ?? 1),
    priority:Number(o.priority ?? 2),
    deadline:o.deadline ?? o.until ?? o.by ?? null,
  }));
  return {
    ...src,
    reputation:clamp01(src.reputation ?? src.rep ?? src.board_reputation ?? 0.5),
    expectation:src.expectation ?? src.season_expectation ?? "Competitive season",
    objectives,
    actions:Array.isArray(src.actions) ? src.actions : [],
  };
}

const EXPECTATION_ORDER=["survive","points","midfield","podiums","race_wins","championship"];
const EXPECTATION_LABEL={
  survive:"Survive / establish the team",
  points:"Score points",
  midfield:"Competitive midfield",
  podiums:"Fight for podiums",
  race_wins:"Win races",
  championship:"Challenge for the championship",
};
function normalizeExpectation(raw){
  const s=String(raw||"").toLowerCase();
  if(/championship|title/.test(s))return "championship";
  if(/race[_ ]?wins?|win one|wins?/.test(s))return "race_wins";
  if(/podium/.test(s))return "podiums";
  if(/midfield|mid-table|top 5|top5|top 6|top6/.test(s))return "midfield";
  if(/points?/.test(s))return "points";
  if(/survive|debut|qualify|stay in|avoid last/.test(s))return "survive";
  return "midfield";
}
function expectationTier(exp){
  if(["championship","race_wins"].includes(exp))return "top";
  if(["podiums","midfield","points"].includes(exp))return "midfield";
  return "backmarker";
}
function boardMetrics(gs,teamId){
  const year=Number(gs?.activeYear);
  const events=(gs?.results||[]).filter((r)=>Number(r?.year)===year);
  let wins=0,podiums=0,points=0;
  for(const event of events){
    for(const row of event?.classification||[]){
      if(String(row?.team_id||"")!==String(teamId))continue;
      const p=Number(row?.position);
      points+=Number(row?.points||0);
      if(p===1)wins++;
      if(p>=1&&p<=3)podiums++;
    }
  }
  const standing=(gs?.standings?.teams||[]).find((r)=>String(r?.team_id??r?.constructor_id??"")===String(teamId));
  return {races:events.length,totalRaces:Math.max(1,(gs?.calendar||[]).length||1),wins,podiums,points,constructorPosition:Number(standing?.position||0)||null,totalTeams:Math.max(1,(gs?.teams||[]).length||1)};
}
function makeObjectives(expectation,metrics){
  const maxPos=Math.max(1,metrics.totalTeams||12);
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
      progress=metrics.constructorPosition?(metrics.constructorPosition<=o.target?1:clamp01(o.target/metrics.constructorPosition)):0;
    }else progress=clamp01(Number(metrics[o.type]||0)/Math.max(1,o.target));
    return {...o,category:"PERFORMANCE",progress,status:progress>=1?"completed":"active",deadline:"Season end"};
  });
}

export default function Board() {
  const gameState = useGame((s)=>s.gameState);
  const setGameState = useGame((s)=>s.setGameState);

  const [status,setStatus] = useState("all");
  const [category,setCategory] = useState("ALL");
  const [showBudget,setShowBudget] = useState(false);
  const [requestedAmount,setRequestedAmount] = useState(500000);
  const [requestReason,setRequestReason] = useState("Development");
  const [requestJustification,setRequestJustification] = useState("");
  const [goalProposal,setGoalProposal] = useState("");

  const teamId = String(gameState?.team?.team_id ?? gameState?.team?.id ?? "");
  const teamName=gameState?.team?.team_name||gameState?.team?.name||"My Team";
  const year = Number(gameState?.activeYear) || 1980;
  const date = String(gameState?.currentDateISO || "").slice(0,10);
  const currentBudget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);

  const brand = (gameState?.teamBrands || []).find(
    (b)=>String(b?.team_id ?? "") === teamId
  );
  const storedBoard = useMemo(()=>normalizeBoard(gameState?.board || {}),[gameState?.board]);
  const expectation = storedBoard?.profile_version===2
    ? normalizeExpectation(storedBoard.expectation)
    : normalizeExpectation(brand?.board_expectation || "midfield");
  const metrics = useMemo(()=>boardMetrics(gameState,teamId),[gameState,teamId]);
  const rewardProfile = useMemo(() => {
    const tier=expectationTier(expectation);
    return (gameState?.dbBoardGoals||[]).find((row)=>String(row?.team_tier||"").toLowerCase()===tier)||null;
  },[gameState?.dbBoardGoals,expectation]);
  const liveObjectives = useMemo(()=>makeObjectives(expectation,metrics).map((o)=>({
    ...o,
    reward:rewardProfile?.bonuses?.hit || null,
    penalty:o.priority===1 ? (rewardProfile?.penalties?.fail_major||null) : (rewardProfile?.penalties?.fail_minor||null),
  })),[expectation,metrics,rewardProfile]);
  const board = useMemo(()=>({
    ...storedBoard,
    profile_version:2,
    expectation,
    reputation:clamp01(storedBoard.reputation ?? 0.55),
    objectives:liveObjectives,
    actions:Array.isArray(storedBoard.actions)?storedBoard.actions:[],
  }),[storedBoard,expectation,liveObjectives]);

  const objectiveScore = useMemo(() => {
    if (!board.objectives.length || metrics.races === 0) return 0.5;
    const sumW = board.objectives.reduce((s,o)=>s + Number(o.weight || 1),0) || 1;
    return clamp01(board.objectives.reduce((s,o)=>{
      const score = o.status === "completed" ? 1 : o.status === "failed" ? 0 : clamp01(o.progress);
      return s + score * Number(o.weight || 1);
    },0) / sumW);
  },[board.objectives,metrics.races]);

  const overallConfidence = useMemo(
    ()=>clamp01(board.reputation * 0.45 + objectiveScore * 0.55),
    [board.reputation,objectiveScore]
  );

  const seasonProgress = clamp01(metrics.races / metrics.totalRaces);
  const reviews = board.actions
    .filter((a)=>a.type==="board_review")
    .sort((a,b)=>Number(b.race_count||0)-Number(a.race_count||0));
  const lastReviewRace = Number(reviews[0]?.race_count ?? -99);
  const reviewCooldown = metrics.races - lastReviewRace < 3;

  const rows = useMemo(
    ()=>board.objectives
      .filter((o)=>status==="all" || o.status===status)
      .filter((o)=>category==="ALL" || o.category===category)
      .sort((a,b)=>a.priority-b.priority),
    [board.objectives,status,category]
  );

  const budgetRequests = board.actions
    .filter((a)=>a.type==="budget_request")
    .sort((a,b)=>String(b.date || "").localeCompare(String(a.date || "")));
  const lastBudgetRequest = budgetRequests[0] || null;
  const cooldownDays = lastBudgetRequest?.date ? daysBetween(lastBudgetRequest.date,date) : 999;
  const budgetCooldown = cooldownDays < 60;

  const reasonMultiplier = {
    "Development":1.10,
    "Facilities":1.05,
    "Driver Contract":0.95,
    "Staff Recruitment":0.95,
    "Cashflow Support":0.80,
  }[requestReason] || 1;

  const approvalCeiling = Math.max(
    250000,
    Math.round(
      Math.min(3_000_000,
        (currentBudget * 0.035 + 350000 + overallConfidence * 800000) * reasonMultiplier
      ) / 50000
    ) * 50000
  );

  const budgetApprovalChance = useMemo(() => {
    const amount=Math.max(0,Number(requestedAmount||0));
    if(!amount || !requestJustification.trim()) return 0;
    const ratio=amount/Math.max(1,approvalCeiling);
    let chance=0.12+overallConfidence*0.72;
    if(ratio<=0.5) chance+=0.12;
    else if(ratio<=1) chance-=Math.max(0,ratio-0.5)*0.18;
    else chance*=Math.exp(-1.75*(ratio-1));
    if(requestReason==="Development"||requestReason==="Facilities") chance+=0.04;
    if(requestReason==="Cashflow Support"&&currentBudget>5_000_000) chance-=0.25;
    return Math.max(0.01,Math.min(0.95,chance));
  },[requestedAmount,requestJustification,approvalCeiling,overallConfidence,requestReason,currentBudget]);

  const persist = (next)=>setGameState({board:next});

  const proposeGoal = () => {
    const proposal = normalizeExpectation(goalProposal);
    if (!goalProposal || proposal === expectation) return;
    const currentRank = EXPECTATION_ORDER.indexOf(expectation);
    const proposalRank = EXPECTATION_ORDER.indexOf(proposal);
    const easier = proposalRank < currentRank;
    const performanceRatio = seasonProgress > 0 ? objectiveScore / seasonProgress : 1;
    const approved = easier
      ? (performanceRatio < 0.80 || overallConfidence < 0.48)
      : overallConfidence >= 0.58;
    const explanation = approved
      ? "Approved: the official season expectation changes from " + EXPECTATION_LABEL[expectation] + " to " + EXPECTATION_LABEL[proposal] + "."
      : easier
        ? "Declined: current results do not yet justify lowering the official season target."
        : "Declined: Board Confidence must be at least 58% before raising the official season target.";
    const action = {
      id:`board_goal_${Date.now()}`,
      type:"goal_change",
      year,
      date,
      status:approved ? "approved" : "declined",
      from:expectation,
      to:proposal,
      explanation,
    };
    persist({
      ...board,
      expectation:approved ? proposal : expectation,
      reputation:clamp01(board.reputation + (approved ? 0.005 : -0.005)),
      actions:[...board.actions,action],
    });
    addInbox("Board", approved ? "Goal change approved" : "Goal change declined", explanation);
    setGoalProposal("");
  };

  const submitBudgetRequest = () => {
    const amount = Math.max(0,Math.round(Number(requestedAmount || 0) / 50000) * 50000);
    if (!amount || budgetCooldown) return;

    if (!requestJustification.trim()) return;
    const approved = Math.random() < budgetApprovalChance;
    const explanation = approved
      ? `Approved: ${fmtMoney(amount)} for ${requestReason.toLowerCase()}. The board accepted the case: "${requestJustification.trim()}". Estimated approval chance was ${Math.round(budgetApprovalChance*100)}%.`
      : `Declined: ${fmtMoney(amount)} for ${requestReason.toLowerCase()}. The board judged the request too aggressive for the current ${pct(overallConfidence)} confidence level and ${fmtMoney(approvalCeiling)} comfort ceiling. Estimated approval chance was ${Math.round(budgetApprovalChance*100)}%.`;

    const action = {
      id:`board_budget_${Date.now()}`,
      type:"budget_request",
      year,
      date,
      status:approved ? "approved" : "declined",
      requested_amount:amount,
      amount:approved ? amount : 0,
      reason:requestReason,
      justification:requestJustification.trim(),
      confidence:overallConfidence,
      approval_chance:budgetApprovalChance,
      approval_ceiling:approvalCeiling,
      explanation,
    };

    const repDelta = approved ? 0.005 : -0.01;
    persist({
      ...board,
      reputation:clamp01(board.reputation + repDelta),
      actions:[...board.actions,action],
    });

    if (approved) {
      const oldBalance = Number(gameState?.finances?.balance ?? currentBudget);
      setGameState({
        team:{...(gameState?.team || {}),budget:currentBudget + amount},
        finances:{
          ...(gameState?.finances || {}),
          budget:currentBudget + amount,
          balance:oldBalance + amount,
          season_income:Number(gameState?.finances?.season_income || 0) + amount,
        },
        financeLog:[
          ...(gameState?.financeLog || []),
          {
            id:`tx_board_${Date.now()}`,
            dateISO:date,
            type:"income",
            category:"Board Funding",
            desc:`Board funding — ${requestReason}`,
            amount,
          },
        ],
      });
    }

    addInbox("Board",approved ? "Budget request approved" : "Budget request declined",explanation);
    setRequestJustification("");
    setShowBudget(false);
  };

  const requestBoardReview = () => {
    if (metrics.races === 0 || reviewCooldown) return;
    const expected = Math.max(0.10, seasonProgress);
    let delta = 0;
    if (objectiveScore >= Math.min(1, expected + 0.15)) delta = 0.02;
    else if (objectiveScore >= expected) delta = 0.01;
    else if (objectiveScore < expected * 0.55) delta = -0.02;
    else if (objectiveScore < expected * 0.80) delta = -0.01;

    const explanation =
      "Review after " + metrics.races + "/" + metrics.totalRaces +
      " races: objective score " + pct(objectiveScore) +
      " vs expected season progress " + pct(expected) + ". " +
      "Board Reputation " + (delta > 0 ? "increased" : delta < 0 ? "decreased" : "was unchanged") +
      " by " + Math.abs(Math.round(delta * 100)) + " point(s).";

    const action = {
      id:`board_review_${Date.now()}`,
      type:"board_review",
      year,
      date,
      status:"completed",
      race_count:metrics.races,
      objective_score:objectiveScore,
      expected_score:expected,
      reputation_delta:delta,
      explanation,
    };
    persist({
      ...board,
      reputation:clamp01(board.reputation + delta),
      actions:[...board.actions,action],
    });
    addInbox("Board","Board review completed",explanation);
  };

  function addInbox(from,subject,body) {
    setGameState({
      inbox:[
        {
          id:`board_msg_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
          from,subject,body,type:"BOARD",tag:"Board",date,unread:true,
        },
        ...(gameState?.inbox || []),
      ],
    });
  }

  return (
    <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
      <div className="rounded-xl border border-white/10 bg-[#12141c] p-5 flex flex-col lg:flex-row lg:items-center gap-4">
        <TeamLogo teamId={teamId} name={teamName} size="h-14 w-14"/>
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Ownership & Expectations</div>
          <h1 className="text-2xl md:text-3xl font-semibold">Board</h1>
          <p className="text-sm text-slate-400">Season {year} · official expectation: <strong className="text-slate-200">{EXPECTATION_LABEL[expectation]}</strong></p>
        </div>
        <div className="flex-1"/>
        <div className="text-right"><div className="text-xs text-slate-500">Current balance</div><div className="text-lg font-semibold">{fmtMoney(currentBudget)}</div></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Metric title="Overall Confidence" value={pct(overallConfidence)} progress={overallConfidence}/>
        <Metric title="Objective Score" value={pct(objectiveScore)} progress={objectiveScore}/>
        <Metric title="Season Progress" value={pct(seasonProgress)} progress={seasonProgress}/>
        <Metric title="Board Reputation" value={pct(board.reputation)} progress={board.reputation}/>
        <Metric title="Funding Ceiling" value={fmtMoney(approvalCeiling)} progress={Math.min(1,approvalCeiling/3000000)}/>
        <Metric title="Constructor Pos." value={metrics.constructorPosition?("P"+metrics.constructorPosition):"—"} progress={metrics.constructorPosition?1-Math.min(1,(metrics.constructorPosition-1)/Math.max(1,metrics.totalTeams-1)):0}/>
      </div>

      <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-4">
        <div className="font-semibold mb-3">Current Sporting Position</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Mini label="Races" value={metrics.races + "/" + metrics.totalRaces}/>
          <Mini label="Constructors" value={metrics.constructorPosition ? "P" + metrics.constructorPosition : "—"}/>
          <Mini label="Points" value={metrics.points}/>
          <Mini label="Wins" value={metrics.wins}/>
          <Mini label="Podiums" value={metrics.podiums}/>
        </div>
      </CardContent></Card>

      <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-4">
        <div className="font-semibold mb-3">Board Actions</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <ActionInfo
            title="Propose Goal Change"
            text="Choose one of the predefined sporting expectations. The board accepts or rejects it using current results and confidence."
          >
            <select className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-2 py-1 text-sm w-full mb-2" value={goalProposal} onChange={(e)=>setGoalProposal(e.target.value)}>
              <option value="">Choose target…</option>
              {EXPECTATION_ORDER.filter((x)=>x!==expectation).map((x)=><option key={x} value={x}>{EXPECTATION_LABEL[x]}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={proposeGoal} disabled={!goalProposal}>Submit Proposal</Button>
          </ActionInfo>

          <ActionInfo
            title="Request Budget"
            text={budgetCooldown
              ? `Funding requests have a 60-day cooldown. Next request is available in ${60-cooldownDays} day(s).`
              : `Ask for a specific amount and explain its purpose. Current estimated approval ceiling: ${fmtMoney(approvalCeiling)}.`}
          >
            <Button size="sm" variant="outline" onClick={()=>setShowBudget((v)=>!v)} disabled={budgetCooldown}>Request Budget</Button>
          </ActionInfo>

          <ActionInfo
            title="Request Board Review"
            text={metrics.races===0
              ? "Available after the first Grand Prix."
              : reviewCooldown
                ? "A Board Review can be requested once every 3 races."
                : `Compares objective score (${pct(objectiveScore)}) with expected season progress (${pct(Math.max(0.10,seasonProgress))}) and updates Board Reputation.`}
          >
            <Button size="sm" variant="outline" onClick={requestBoardReview} disabled={metrics.races===0||reviewCooldown}>Request Board Review</Button>
          </ActionInfo>
        </div>
      </CardContent></Card>

      {showBudget && (
        <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-4 space-y-3">
          <div className="font-semibold">Additional Budget Request</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              Amount
              <input
                type="number"
                min="50000"
                step="50000"
                value={requestedAmount}
                onChange={(e)=>setRequestedAmount(Number(e.target.value))}
                className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full"
              />
            </label>
            <label className="text-sm">
              Reason
              <select className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full" value={requestReason} onChange={(e)=>setRequestReason(e.target.value)}>
                {["Development","Facilities","Driver Contract","Staff Recruitment","Cashflow Support"].map((x)=><option key={x}>{x}</option>)}
              </select>
            </label>
            <div className="border rounded-lg p-3 text-sm">
              <div className="text-xs text-slate-400">Estimated approval probability</div>
              <div className="text-xl font-semibold">{Math.round(budgetApprovalChance*100)}%</div>
              <div className="text-xs text-slate-400 mt-1">Comfort ceiling {fmtMoney(approvalCeiling)} · Confidence {pct(overallConfidence)}</div>
            </div>
          </div>
          <label className="text-sm block">
            Justification
            <textarea
              value={requestJustification}
              onChange={(e)=>setRequestJustification(e.target.value)}
              placeholder="Explain why the team needs this funding and what it will achieve…"
              className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full min-h-[90px]"
            />
          </label>
          <div className="text-xs text-slate-400">
            Requests far above the board's comfort ceiling remain possible, but acceptance probability collapses rapidly. A $100m request should effectively be treated as extraordinary.
          </div>
          <Button onClick={submitBudgetRequest} disabled={Number(requestedAmount)<=0||!requestJustification.trim()}>Submit Request</Button>
        </CardContent></Card>
      )}

      <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-4 flex flex-col md:flex-row gap-3">
        <select className="border rounded px-3 py-2 text-sm" value={status} onChange={(e)=>setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="paused">Paused</option>
        </select>
        <select className="border rounded px-3 py-2 text-sm" value={category} onChange={(e)=>setCategory(e.target.value)}>
          <option value="ALL">All categories</option>
          {["PERFORMANCE","FINANCIAL","DEV","STAFF","PR","OTHER"].map((x)=><option key={x}>{x}</option>)}
        </select>
        <div className="flex-1"/>
        <div className="text-sm text-slate-400">{rows.length} objectives</div>
      </CardContent></Card>

      <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-0 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[#171a23] text-slate-300"><tr>
            <th className="px-3 py-2 text-left">Priority</th>
            <th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-left">Objective</th>
            <th className="px-3 py-2 text-left">Deadline</th>
            <th className="px-3 py-2 text-left">Progress</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Reward / Penalty</th>
          </tr></thead>
          <tbody>
            {rows.map((o)=><tr key={o.id} className="border-t border-white/10">
              <td className="px-3 py-2">P{o.priority}</td>
              <td className="px-3 py-2">{titleCase(o.category)}</td>
              <td className="px-3 py-2">
                <div className="font-medium">{o.title}</div>
                {o.desc && <div className="text-xs text-slate-400">{o.desc}</div>}
              </td>
              <td className="px-3 py-2">{o.deadline || "—"}</td>
              <td className="px-3 py-2 min-w-[150px]"><div className="text-xs">{pct(o.progress)}</div><Bar value={o.progress}/></td>
              <td className="px-3 py-2"><span className="px-2 py-1 rounded bg-white/10 text-xs">{titleCase(o.status)}</span></td>
              <td className="px-3 py-2 text-xs">
                {o.reward && <div className="text-emerald-300">Reward: {o.reward}</div>}
                {o.penalty && <div className="text-rose-300">Penalty: {o.penalty}</div>}
                {!o.reward && !o.penalty && "—"}
              </td>
            </tr>)}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-5 text-center text-slate-400">No objectives for this filter.</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>

      <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-4">
        <div className="font-semibold mb-3">Board Interaction History</div>
        {board.actions.length ? (
          <div className="space-y-2">
            {[...board.actions].reverse().map((a)=><div key={a.id} className="border rounded-lg p-3 text-sm">
              <div className="flex flex-col md:flex-row md:items-center gap-2">
                <strong>{titleCase(a.type)}</strong>
                <span>{a.date || "—"}</span>
                {a.reason && <span>{a.reason}</span>}
                {a.requested_amount ? <span>Requested {fmtMoney(a.requested_amount)}</span> : null}
                {a.amount ? <span>Approved {fmtMoney(a.amount)}</span> : null}
                <span className="md:ml-auto px-2 py-1 bg-white/10 rounded text-xs">{titleCase(a.status)}</span>
              </div>
              {a.explanation && <div className="text-xs text-slate-400 mt-2">{a.explanation}</div>}
            </div>)}
          </div>
        ) : <div className="text-sm text-slate-400">No board interactions in this career yet.</div>}
      </CardContent></Card>
    </div>
  );
}

function ActionInfo({title,text,children}) {
  return <div className="border rounded-lg p-3"><div className="font-medium">{title}</div><p className="text-xs text-slate-400 mt-1 min-h-[2.5rem]">{text}</p><div className="mt-3">{children}</div></div>;
}
function Metric({title,value,progress}) {
  return <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-4"><div className="text-sm text-slate-400">{title}</div><div className="text-xl font-semibold my-1">{value}</div><Bar value={progress}/></CardContent></Card>;
}
function Bar({value}) {
  return <div className="h-2 bg-white/10 rounded overflow-hidden mt-1"><div className="h-full bg-slate-200" style={{width:`${clamp01(value)*100}%`}}/></div>;
}
function Mini({label,value}) {
  return <div className="border rounded p-2"><div className="text-[10px] text-slate-400">{label}</div><div className="font-medium">{value??"—"}</div></div>;
}
