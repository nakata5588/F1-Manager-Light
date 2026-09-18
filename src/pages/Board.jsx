import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

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

export default function Board() {
  const gameState = useGame((s)=>s.gameState);
  const setGameState = useGame((s)=>s.setGameState);

  const [fallback,setFallback] = useState(null);
  const [status,setStatus] = useState("all");
  const [category,setCategory] = useState("ALL");
  const [showBudget,setShowBudget] = useState(false);
  const [requestedAmount,setRequestedAmount] = useState(500000);
  const [requestReason,setRequestReason] = useState("Development");

  useEffect(() => {
    fetch("/data/board.json")
      .then((r)=>r.ok ? r.json() : null)
      .then(setFallback)
      .catch(()=>setFallback(null));
  },[]);

  const teamId = String(gameState?.team?.team_id ?? gameState?.team?.id ?? "");
  const year = Number(gameState?.activeYear) || 1980;
  const date = String(gameState?.currentDateISO || "").slice(0,10);
  const currentBudget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);

  const brand = (gameState?.teamBrands || []).find(
    (b)=>String(b?.team_id ?? "") === teamId
  );
  const source = gameState?.board || fallback || {
    reputation:0.5,
    expectation:brand?.board_expectation || "Competitive season",
    objectives:[],
  };
  const board = useMemo(()=>normalizeBoard(source),[source]);

  const objectiveScore = useMemo(() => {
    if (!board.objectives.length) return 0.5;
    const sumW = board.objectives.reduce((s,o)=>s + Number(o.weight || 1),0) || 1;
    return clamp01(board.objectives.reduce((s,o)=>{
      const score = o.status === "completed" ? 1 : o.status === "failed" ? 0 : clamp01(o.progress);
      return s + score * Number(o.weight || 1);
    },0) / sumW);
  },[board.objectives]);

  const overallConfidence = useMemo(
    ()=>clamp01(board.reputation * 0.45 + objectiveScore * 0.55),
    [board.reputation,objectiveScore]
  );

  const rows = useMemo(
    ()=>board.objectives
      .filter((o)=>status==="all" || o.status===status)
      .filter((o)=>category==="ALL" || o.category===category)
      .sort((a,b)=>a.priority-b.priority),
    [board.objectives,status,category]
  );

  const pendingGoal = board.actions.find(
    (a)=>a.type==="goal_change" && a.status==="pending" && Number(a.year)===year
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

  const persist = (next)=>setGameState({board:next});

  const proposeGoal = () => {
    const proposal = window.prompt("Propose a revised season expectation:",String(board.expectation || ""));
    if (!proposal || proposal.trim() === String(board.expectation || "").trim()) return;
    const action = {
      id:`board_goal_${Date.now()}`,
      type:"goal_change",
      year,
      date,
      status:"pending",
      proposal:proposal.trim(),
    };
    persist({...board,actions:[...board.actions,action],pendingExpectation:proposal.trim()});
    addInbox(
      "Board",
      "Goal-change proposal submitted",
      `You asked the board to revise the season expectation to: ${proposal.trim()}. The request is pending review.`
    );
  };

  const submitBudgetRequest = () => {
    const amount = Math.max(0,Math.round(Number(requestedAmount || 0) / 50000) * 50000);
    if (!amount || budgetCooldown) return;

    let approved = true;
    let explanation = "";

    if (overallConfidence < 0.38) {
      approved = false;
      explanation = `Declined: board confidence is only ${pct(overallConfidence)}. The minimum for additional funding is 38%.`;
    } else if (amount > approvalCeiling) {
      approved = false;
      explanation = `Declined: the requested ${fmtMoney(amount)} exceeds the current approval ceiling of ${fmtMoney(approvalCeiling)} for ${requestReason.toLowerCase()}.`;
    } else if (requestReason === "Cashflow Support" && currentBudget > 5_000_000) {
      approved = false;
      explanation = `Declined: the board does not consider emergency cashflow support necessary while the team still holds ${fmtMoney(currentBudget)}.`;
    } else {
      explanation = `Approved: ${fmtMoney(amount)} for ${requestReason.toLowerCase()}. The request fits the current ${pct(overallConfidence)} confidence level and the ${fmtMoney(approvalCeiling)} approval ceiling.`;
    }

    const action = {
      id:`board_budget_${Date.now()}`,
      type:"budget_request",
      year,
      date,
      status:approved ? "approved" : "declined",
      requested_amount:amount,
      amount:approved ? amount : 0,
      reason:requestReason,
      confidence:overallConfidence,
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
    setShowBudget(false);
  };

  const reportProgress = () => {
    const previousReports = board.actions
      .filter((a)=>a.type==="progress_report")
      .sort((a,b)=>String(b.date || "").localeCompare(String(a.date || "")));
    const previousScore = Number(previousReports[0]?.objective_score ?? 0.5);
    const improvement = objectiveScore - previousScore;
    const delta = Math.max(-0.02,Math.min(0.02,improvement * 0.08));

    const action = {
      id:`board_report_${Date.now()}`,
      type:"progress_report",
      year,
      date,
      status:"submitted",
      confidence:overallConfidence,
      objective_score:objectiveScore,
      previous_objective_score:previousScore,
      reputation_delta:delta,
    };

    persist({
      ...board,
      reputation:clamp01(board.reputation + delta),
      actions:[...board.actions,action],
    });

    const direction = delta > 0 ? "improved" : delta < 0 ? "reduced" : "did not change";
    addInbox(
      "Board",
      "Progress report received",
      `The report recorded objective completion at ${pct(objectiveScore)} versus ${pct(previousScore)} in the previous report baseline. Board reputation ${direction} by ${Math.abs(Math.round(delta*100))} point(s).`
    );
  };

  function addInbox(from,subject,body) {
    setGameState({
      inbox:[
        {
          id:`board_msg_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
          from,subject,body,tag:"Board",date,
        },
        ...(gameState?.inbox || []),
      ],
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">Board</h1>
          <p className="text-sm text-muted-foreground">Season {year} · expectation: <strong>{board.expectation}</strong></p>
        </div>
        <div className="flex-1"/>
        {pendingGoal && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">Goal proposal pending</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Metric title="Overall Confidence" value={pct(overallConfidence)} progress={overallConfidence}/>
        <Metric title="Objective Score" value={pct(objectiveScore)} progress={objectiveScore}/>
        <Metric title="Board Reputation" value={pct(board.reputation)} progress={board.reputation}/>
      </div>

      <Card><CardContent className="p-4">
        <div className="font-semibold mb-3">Board Actions</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <ActionInfo
            title="Propose Goal Change"
            text="Ask the board to revise the current season expectation. The proposal is recorded as pending rather than changing the target immediately."
          >
            <Button size="sm" variant="outline" onClick={proposeGoal} disabled={Boolean(pendingGoal)}>Propose Goal Change</Button>
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
            title="Report Progress"
            text="Send a formal snapshot of objective progress to the board. Reputation moves slightly depending on whether your objective score improved since the previous report."
          >
            <Button size="sm" variant="outline" onClick={reportProgress}>Report Progress</Button>
          </ActionInfo>
        </div>
      </CardContent></Card>

      {showBudget && (
        <Card><CardContent className="p-4 space-y-3">
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
                className="mt-1 border rounded px-3 py-2 w-full"
              />
            </label>
            <label className="text-sm">
              Reason
              <select className="mt-1 border rounded px-3 py-2 w-full" value={requestReason} onChange={(e)=>setRequestReason(e.target.value)}>
                {["Development","Facilities","Driver Contract","Staff Recruitment","Cashflow Support"].map((x)=><option key={x}>{x}</option>)}
              </select>
            </label>
            <div className="border rounded-lg p-3 text-sm">
              <div className="text-xs text-muted-foreground">Current approval ceiling</div>
              <div className="font-semibold">{fmtMoney(approvalCeiling)}</div>
              <div className="text-xs text-muted-foreground mt-1">Confidence {pct(overallConfidence)}</div>
            </div>
          </div>
          <Button onClick={submitBudgetRequest} disabled={Number(requestedAmount)<=0}>Submit Request</Button>
        </CardContent></Card>
      )}

      <Card><CardContent className="p-4 flex flex-col md:flex-row gap-3">
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
        <div className="text-sm text-muted-foreground">{rows.length} objectives</div>
      </CardContent></Card>

      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="px-3 py-2 text-left">Priority</th>
            <th className="px-3 py-2 text-left">Category</th>
            <th className="px-3 py-2 text-left">Objective</th>
            <th className="px-3 py-2 text-left">Deadline</th>
            <th className="px-3 py-2 text-left">Progress</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Reward / Penalty</th>
          </tr></thead>
          <tbody>
            {rows.map((o)=><tr key={o.id} className="border-t">
              <td className="px-3 py-2">P{o.priority}</td>
              <td className="px-3 py-2">{titleCase(o.category)}</td>
              <td className="px-3 py-2">
                <div className="font-medium">{o.title}</div>
                {o.desc && <div className="text-xs text-muted-foreground">{o.desc}</div>}
              </td>
              <td className="px-3 py-2">{o.deadline || "—"}</td>
              <td className="px-3 py-2 min-w-[150px]"><div className="text-xs">{pct(o.progress)}</div><Bar value={o.progress}/></td>
              <td className="px-3 py-2"><span className="px-2 py-1 rounded bg-gray-100 text-xs">{titleCase(o.status)}</span></td>
              <td className="px-3 py-2 text-xs">
                {o.reward && <div className="text-emerald-700">Reward: {o.reward}</div>}
                {o.penalty && <div className="text-rose-700">Penalty: {o.penalty}</div>}
                {!o.reward && !o.penalty && "—"}
              </td>
            </tr>)}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-5 text-center text-muted-foreground">No objectives for this filter.</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>

      <Card><CardContent className="p-4">
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
                <span className="md:ml-auto px-2 py-1 bg-gray-100 rounded text-xs">{titleCase(a.status)}</span>
              </div>
              {a.explanation && <div className="text-xs text-muted-foreground mt-2">{a.explanation}</div>}
            </div>)}
          </div>
        ) : <div className="text-sm text-muted-foreground">No board interactions in this career yet.</div>}
      </CardContent></Card>
    </div>
  );
}

function ActionInfo({title,text,children}) {
  return <div className="border rounded-lg p-3"><div className="font-medium">{title}</div><p className="text-xs text-muted-foreground mt-1 min-h-[2.5rem]">{text}</p><div className="mt-3">{children}</div></div>;
}
function Metric({title,value,progress}) {
  return <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{title}</div><div className="text-xl font-semibold my-1">{value}</div><Bar value={progress}/></CardContent></Card>;
}
function Bar({value}) {
  return <div className="h-2 bg-gray-100 rounded overflow-hidden mt-1"><div className="h-full bg-slate-800" style={{width:`${clamp01(value)*100}%`}}/></div>;
}
