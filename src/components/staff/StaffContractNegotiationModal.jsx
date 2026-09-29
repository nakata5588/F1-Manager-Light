import React, { useEffect, useMemo, useState } from "react";

function money(value){
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value)||0);
}

export default function StaffContractNegotiationModal({
  staff,
  role,
  roleLabel=null,
  expectedSalary=0,
  incumbent=null,
  replacementCost=0,
  transfer=null,
  onClose,
  onSubmit,
}){
  const suggested=useMemo(
    ()=>Math.max(20_000,Math.round(Number(expectedSalary||100_000)/5_000)*5_000),
    [expectedSalary]
  );
  const [salary,setSalary]=useState(suggested);
  const [years,setYears]=useState(1);
  useEffect(()=>setSalary(suggested),[suggested]);

  if(!staff)return null;
  const name=staff?.name||staff?.staff_name||staff?.display_name||staff?.id||"Staff";

  return <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/45 p-4">
    <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#12141c] text-slate-100 shadow-2xl">
      <div className="border-b border-white/10 p-5">
        <div className="text-xs uppercase tracking-wide text-slate-400">Staff contract negotiations</div>
        <h2 className="mt-1 text-xl font-semibold">{name}</h2>
        <p className="mt-1 text-sm text-slate-400">Submit a formal offer. The Staff member will respond after the calendar advances.</p>
      </div>

      <div className="grid gap-4 p-5">
        <div className="rounded-xl border border-white/10 bg-[#171a23] p-3 text-sm">
          <div className="text-slate-400">Role</div>
          <div className="font-semibold">{roleLabel||role}</div>
          <div className="mt-2 text-slate-400">Market salary guide</div>
          <div className="font-semibold">{money(expectedSalary)}</div>
        </div>

        {transfer&&Number(transfer.fee)>0?<div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-3 text-sm text-sky-100">
          {name} is under contract with <strong>{transfer.sellerTeamName||"another team"}</strong>. If personal terms are accepted, Staff compensation of <strong>{money(transfer.fee)}</strong> will be paid to that team.
        </div>:null}

        {incumbent&&<div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
          If this offer is accepted, {incumbent.name||"the current incumbent"} will be replaced. Estimated contract termination cost: <strong>{money(replacementCost)}</strong>.
        </div>}

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Annual salary</span>
          <input
            type="number"
            min="20000"
            step="5000"
            className="rounded-md border border-white/10 bg-[#191c26] px-3 py-2 text-slate-100"
            value={salary}
            onChange={(event)=>setSalary(Math.max(20_000,Number(event.target.value)||0))}
          />
          <span className="text-xs text-slate-400">Current offer: {money(salary)}</span>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Contract length</span>
          <select
            className="rounded-md border border-white/10 bg-[#191c26] px-3 py-2 text-slate-100"
            value={years}
            onChange={(event)=>setYears(Number(event.target.value))}
          >
            {[1,2,3,4,5].map((value)=><option key={value} value={value}>{value} year{value===1?"":"s"}</option>)}
          </select>
        </label>

        <div className="rounded-xl border border-white/10 bg-[#171a23] p-3 text-xs text-slate-300">
          Salary, team reputation, contract length and your Manager negotiation ability influence the chance of agreement. Contracted Staff also require compensation to their current team. Owners and Sponsor Backers use the stakeholder market rather than employment contracts.
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-white/10 p-4">
        <button type="button" className="rounded-md border border-white/10 bg-[#171a23] px-4 py-2 text-sm hover:bg-white/10" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"
          onClick={()=>onSubmit?.({salary,years,role})}
        >Submit offer</button>
      </div>
    </div>
  </div>;
}
