import { useState } from "react";
import { Info } from "lucide-react";

export function InfoPopover({
  title="How it works",
  children,
  align="left",
  className="",
}) {
  const [open,setOpen]=useState(false);
  return (
    <span className={"relative inline-flex "+className}>
      <button
        type="button"
        onClick={()=>setOpen((value)=>!value)}
        className={
          "inline-flex h-6 w-6 items-center justify-center rounded-full border text-slate-400 transition "+
          (open
            ?"border-sky-400/30 bg-sky-500/10 text-sky-300"
            :"border-white/10 bg-white/[0.03] hover:border-white/20 hover:text-slate-200")
        }
        aria-expanded={open}
        title={title}
      >
        <Info size={13}/>
        <span className="sr-only">{title}</span>
      </button>
      {open&&(
        <span
          className={
            "absolute top-8 z-50 w-[min(21rem,calc(100vw-2rem))] rounded-lg border border-sky-400/15 bg-[#111722] p-3 text-left text-[11px] leading-4 text-slate-400 shadow-2xl "+
            (align==="right"?"right-0":"left-0")
          }
        >
          <span className="mb-1 block font-semibold text-slate-200">{title}</span>
          <span className="block">{children}</span>
        </span>
      )}
    </span>
  );
}

export default InfoPopover;
