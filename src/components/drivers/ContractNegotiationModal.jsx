import React, { useEffect, useMemo, useState } from "react";
import { driverRoleSalaryMultiplier } from "../../domain/driverContracts.js";

function money(value){
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value)||0);
}

export default function ContractNegotiationModal({
  driver,
  roles=[],
  expectedSalary=0,
  contextNote="",
  onClose,
  onSubmit,
}){
  const initialRole=roles[0]||"Reserve Driver";
  const [role,setRole]=useState(initialRole);
  const [years,setYears]=useState(1);
  const suggested=useMemo(
    ()=>Math.max(75_000,Math.round(Number(expectedSalary||150_000)*driverRoleSalaryMultiplier(role)/5_000)*5_000),
    [expectedSalary,role]
  );
  const [salary,setSalary]=useState(suggested);

  useEffect(()=>{setSalary(suggested);},[suggested]);

  if(!driver)return null;
  const name=driver?.name||driver?.display_name||driver?.driver_name||driver?.id||"Driver";

  return (
    <div className="fixed inset-0 z-[10020] bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border">
        <div className="p-5 border-b">
          <div className="text-xs uppercase tracking-wide text-gray-500">Contract negotiations</div>
          <h2 className="text-xl font-semibold mt-1">{name}</h2>
          <p className="text-sm text-gray-500 mt-1">
            Submit a formal offer. The driver's representatives will respond after the calendar advances.
          </p>
        </div>

        <div className="p-5 grid gap-4">
          {contextNote&&(
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {contextNote}
            </div>
          )}
          <div className="rounded-xl bg-gray-50 p-3 text-sm">
            <div className="text-gray-500">Role-neutral market value</div>
            <div className="font-semibold">{money(expectedSalary)}</div>
            <div className="text-xs text-gray-500 mt-1">Role-adjusted guide: {money(suggested)}</div>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="font-medium">Role</span>
            <select className="border rounded-md px-3 py-2" value={role} onChange={(e)=>setRole(e.target.value)}>
              {roles.map((value)=><option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium">Annual salary</span>
            <input
              type="number"
              min="50000"
              step="5000"
              className="border rounded-md px-3 py-2"
              value={salary}
              onChange={(e)=>setSalary(Math.max(50_000,Number(e.target.value)||0))}
            />
            <span className="text-xs text-gray-500">Current offer: {money(salary)}</span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium">Contract length</span>
            <select className="border rounded-md px-3 py-2" value={years} onChange={(e)=>setYears(Number(e.target.value))}>
              {[1,2,3,4,5].map((value)=><option key={value} value={value}>{value} year{value===1?"":"s"}</option>)}
            </select>
          </label>

          <div className="rounded-xl border p-3 text-xs text-gray-600">
            A stronger salary, longer deal and more prominent race role can improve the chance of agreement. Reserve/Test roles may be less attractive to highly rated drivers.
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button type="button" className="border rounded-md px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="rounded-md px-4 py-2 text-sm bg-slate-900 text-white"
            onClick={()=>onSubmit?.({salary,years,role})}
          >
            Submit offer
          </button>
        </div>
      </div>
    </div>
  );
}
