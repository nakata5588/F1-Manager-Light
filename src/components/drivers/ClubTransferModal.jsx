import React, { useEffect, useState } from "react";

function money(value){
  return new Intl.NumberFormat("en-US",{
    style:"currency",
    currency:"USD",
    maximumFractionDigits:0,
  }).format(Number(value)||0);
}

export default function ClubTransferModal({
  driver,
  sellerTeamName,
  suggestedFee=0,
  availableFunds=0,
  onClose,
  onSubmit,
}){
  const initial=Math.max(5_000,Math.round(Number(suggestedFee||100_000)/5_000)*5_000);
  const [fee,setFee]=useState(initial);
  useEffect(()=>setFee(initial),[initial]);

  if(!driver)return null;
  const name=driver?.name||driver?.display_name||driver?.driver_name||driver?.id||"Driver";
  const affordable=Number(fee)>0&&Number(fee)<=Number(availableFunds||0);

  return (
    <div className="fixed inset-0 z-[10020] bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border">
        <div className="p-5 border-b">
          <div className="text-xs uppercase tracking-wide text-gray-500">Club-to-club transfer</div>
          <h2 className="text-xl font-semibold mt-1">{name}</h2>
          <p className="text-sm text-gray-500 mt-1">
            Negotiate permission with {sellerTeamName||"the current team"} before discussing personal terms.
          </p>
        </div>

        <div className="p-5 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 p-3 text-sm">
              <div className="text-gray-500">Suggested opening value</div>
              <div className="font-semibold">{money(suggestedFee)}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-sm">
              <div className="text-gray-500">Available funds</div>
              <div className="font-semibold">{money(availableFunds)}</div>
            </div>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="font-medium">Transfer fee offer</span>
            <input
              type="number"
              min="5000"
              step="5000"
              className="border rounded-md px-3 py-2"
              value={fee}
              onChange={(e)=>setFee(Math.max(0,Number(e.target.value)||0))}
            />
            <span className={"text-xs "+(affordable?"text-gray-500":"text-red-600")}>
              {affordable?("Offer: "+money(fee)):"This offer exceeds the team's available funds."}
            </span>
          </label>

          <div className="rounded-xl border p-3 text-xs text-gray-600">
            The current team may accept, reject or return a counter-offer. No money changes hands until the driver also accepts personal terms and the transfer is completed.
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button type="button" className="border rounded-md px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            disabled={!affordable}
            className="rounded-md px-4 py-2 text-sm bg-slate-900 text-white disabled:opacity-40"
            onClick={()=>onSubmit?.({fee})}
          >
            Submit club offer
          </button>
        </div>
      </div>
    </div>
  );
}
