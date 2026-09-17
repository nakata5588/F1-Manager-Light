import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

const clamp01=(x)=>Math.max(0,Math.min(1,Number(x)||0));
const pct=(x)=>`${Math.round(clamp01(x)*100)}%`;
const titleCase=(s)=>String(s||"").replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase());
const fmtMoney=(n)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n||0));

function normalizeBoard(raw){
  const src=raw&&typeof raw==="object"?raw:{};
  const objectives=(Array.isArray(src.objectives)?src.objectives:Array.isArray(src.goals)?src.goals:[]).map((o,i)=>({
    ...o,
    id:o.id??`OBJ_${i}`,
    category:String(o.category??o.type??"OTHER").toUpperCase(),
    title:o.title??o.name??"Objective",
    desc:o.desc??o.description??"",
    status:String(o.status??"active").toLowerCase(),
    progress:clamp01(o.progress??(o.done?1:0)),
    weight:Number(o.weight??1),
    priority:Number(o.priority??2),
    deadline:o.deadline??o.until??o.by??null,
  }));
  return {
    ...src,
    reputation:clamp01(src.reputation??src.rep??src.board_reputation??0.5),
    expectation:src.expectation??src.season_expectation??"Competitive season",
    objectives,
    actions:Array.isArray(src.actions)?src.actions:[],
  };
}

export default function Board(){
  const gameState=useGame(s=>s.gameState);
  const setGameState=useGame(s=>s.setGameState);
  const [fallback,setFallback]=useState(null);
  const [status,setStatus]=useState("all");
  const [category,setCategory]=useState("ALL");

  useEffect(()=>{fetch("/data/board.json").then(r=>r.ok?r.json():null).then(setFallback).catch(()=>setFallback(null));},[]);

  const teamId=String(gameState?.team?.team_id??gameState?.team?.id??"");
  const year=Number(gameState?.activeYear)||1980;
  const date=String(gameState?.currentDateISO||"").slice(0,10);
  const brand=(gameState?.teamBrands||[]).find(b=>String(b?.team_id??"")===teamId);
  const source=gameState?.board || fallback || {
    reputation:0.5,
    expectation:brand?.board_expectation||"Competitive season",
    objectives:[],
  };
  const board=useMemo(()=>normalizeBoard(source),[source]);

  const overallConfidence=useMemo(()=>{
    const active=board.objectives.filter(o=>o.status==="active");
    if(!active.length)return board.reputation;
    const sumW=active.reduce((s,o)=>s+Number(o.weight||1),0)||1;
    const obj=active.reduce((s,o)=>s+clamp01(o.progress)*Number(o.weight||1),0)/sumW;
    return clamp01(board.reputation*0.45+obj*0.55);
  },[board]);

  const rows=useMemo(()=>board.objectives.filter(o=>(status==="all"||o.status===status)&&(category==="ALL"||o.category===category)).sort((a,b)=>a.priority-b.priority),[board.objectives,status,category]);
  const budgetRequest=board.actions.find(a=>a.type==="budget_request"&&Number(a.year)===year);
  const pendingGoal=board.actions.find(a=>a.type==="goal_change"&&a.status==="pending"&&Number(a.year)===year);

  const persist=(next)=>setGameState({board:next});

  const proposeGoal=()=>{
    const proposal=window.prompt("Propose a revised season expectation:",String(board.expectation||""));
    if(!proposal||proposal.trim()===String(board.expectation||"").trim())return;
    const action={id:`board_goal_${Date.now()}`,type:"goal_change",year,date,status:"pending",proposal:proposal.trim()};
    const next={...board,actions:[...board.actions,action],pendingExpectation:proposal.trim()};
    persist(next);
    addInbox("Board","Goal-change proposal submitted",`You asked the board to revise the season expectation to: ${proposal.trim()}. The request is pending review.`);
  };

  const requestBudget=()=>{
    if(budgetRequest)return;
    const approved=overallConfidence>=0.45;
    const amount=approved?Math.round(250_000+overallConfidence*750_000):0;
    const action={id:`board_budget_${Date.now()}`,type:"budget_request",year,date,status:approved?"approved":"declined",amount,confidence:overallConfidence};
    const rep=clamp01(board.reputation+(approved?0.01:-0.015));
    persist({...board,reputation:rep,actions:[...board.actions,action]});
    if(approved){
      const oldBudget=Number(gameState?.team?.budget??gameState?.finances?.balance??0);
      const oldBalance=Number(gameState?.finances?.balance??oldBudget);
      setGameState({
        team:{...(gameState?.team||{}),budget:oldBudget+amount},
        finances:{...(gameState?.finances||{}),budget:oldBudget+amount,balance:oldBalance+amount,season_income:Number(gameState?.finances?.season_income||0)+amount},
        financeLog:[...(gameState?.financeLog||[]),{id:`tx_board_${Date.now()}`,dateISO:date,type:"income",category:"Board Funding",desc:"Additional board funding",amount}],
      });
      addInbox("Board","Budget request approved",`The board approved additional funding of ${fmtMoney(amount)}.`);
    }else{
      addInbox("Board","Budget request declined","The board declined the additional budget request. Improve confidence and objective progress before the next season.");
    }
  };

  const reportProgress=()=>{
    const completed=board.objectives.filter(o=>o.status==="completed").length;
    const failed=board.objectives.filter(o=>o.status==="failed").length;
    const delta=completed>failed?0.02:completed===failed?0.005:-0.01;
    const action={id:`board_report_${Date.now()}`,type:"progress_report",year,date,status:"submitted",confidence:overallConfidence};
    persist({...board,reputation:clamp01(board.reputation+delta),actions:[...board.actions,action]});
    addInbox("Board","Progress report received",`Board confidence is currently ${pct(overallConfidence)}. Reputation adjustment: ${delta>=0?"+":""}${Math.round(delta*100)} pts.`);
  };

  function addInbox(from,subject,body){
    setGameState({inbox:[{id:`board_msg_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,from,subject,body,tag:"Board",date},...(gameState?.inbox||[])]});
  }

  return <div className="p-4 md:p-6 space-y-4">
    <div className="flex flex-col md:flex-row md:items-center gap-3">
      <div><h1 className="text-2xl md:text-3xl font-semibold">Board</h1><p className="text-sm text-muted-foreground">Season {year} · expectation: <strong>{board.expectation}</strong></p></div>
      <div className="flex-1"/>{pendingGoal&&<span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">Goal proposal pending</span>}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Metric title="Overall Confidence" value={pct(overallConfidence)} progress={overallConfidence}/>
      <Metric title="Board Reputation" value={pct(board.reputation)} progress={board.reputation}/>
      <Card><CardContent className="p-4">
        <div className="text-sm text-muted-foreground mb-2">Board Actions</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={proposeGoal} disabled={Boolean(pendingGoal)}>Propose Goal Change</Button>
          <Button size="sm" variant="outline" onClick={requestBudget} disabled={Boolean(budgetRequest)}>{budgetRequest?"Budget Requested":"Request Budget"}</Button>
          <Button size="sm" variant="outline" onClick={reportProgress}>Report Progress</Button>
        </div>
      </CardContent></Card>
    </div>

    <Card><CardContent className="p-4 flex flex-col md:flex-row gap-3">
      <select className="border rounded px-3 py-2 text-sm" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="paused">Paused</option></select>
      <select className="border rounded px-3 py-2 text-sm" value={category} onChange={e=>setCategory(e.target.value)}><option value="ALL">All categories</option>{["PERFORMANCE","FINANCIAL","DEV","STAFF","PR","OTHER"].map(c=><option key={c}>{c}</option>)}</select>
      <div className="flex-1"/>
      <div className="text-sm text-muted-foreground">{rows.length} objectives</div>
    </CardContent></Card>

    <Card><CardContent className="p-0 overflow-x-auto"><table className="min-w-full text-sm">
      <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">Priority</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-left">Objective</th><th className="px-3 py-2 text-left">Deadline</th><th className="px-3 py-2 text-left">Progress</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Reward / Penalty</th></tr></thead>
      <tbody>{rows.map(o=><tr key={o.id} className="border-t">
        <td className="px-3 py-2">P{o.priority}</td><td className="px-3 py-2">{titleCase(o.category)}</td>
        <td className="px-3 py-2"><div className="font-medium">{o.title}</div>{o.desc&&<div className="text-xs text-muted-foreground">{o.desc}</div>}</td>
        <td className="px-3 py-2">{o.deadline||"—"}</td>
        <td className="px-3 py-2 min-w-[150px]"><div className="flex justify-between text-xs"><span>{pct(o.progress)}</span></div><Bar value={o.progress}/></td>
        <td className="px-3 py-2"><span className="px-2 py-1 rounded bg-gray-100 text-xs">{titleCase(o.status)}</span></td>
        <td className="px-3 py-2 text-xs">{o.reward&&<div className="text-emerald-700">Reward: {o.reward}</div>}{o.penalty&&<div className="text-rose-700">Penalty: {o.penalty}</div>}{!o.reward&&!o.penalty&&"—"}</td>
      </tr>)}
      {!rows.length&&<tr><td colSpan={7} className="px-3 py-5 text-center text-muted-foreground">No objectives for this filter.</td></tr>}</tbody>
    </table></CardContent></Card>

    <Card><CardContent className="p-4">
      <div className="font-semibold mb-3">Board Interaction History</div>
      {board.actions.length?<div className="space-y-2">{[...board.actions].reverse().map(a=><div key={a.id} className="border rounded-lg p-3 text-sm flex flex-col md:flex-row md:items-center gap-2"><strong>{titleCase(a.type)}</strong><span>{a.date||"—"}</span><span className="text-muted-foreground">{a.proposal||""}</span>{a.amount?<span>{fmtMoney(a.amount)}</span>:null}<span className="md:ml-auto px-2 py-1 bg-gray-100 rounded text-xs">{titleCase(a.status)}</span></div>)}</div>:<div className="text-sm text-muted-foreground">No board interactions in this career yet.</div>}
    </CardContent></Card>
  </div>;
}

function Metric({title,value,progress}){return <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{title}</div><div className="text-xl font-semibold my-1">{value}</div><Bar value={progress}/></CardContent></Card>;}
function Bar({value}){return <div className="h-2 bg-gray-100 rounded overflow-hidden mt-1"><div className="h-full bg-slate-800" style={{width:`${clamp01(value)*100}%`}}/></div>;}
