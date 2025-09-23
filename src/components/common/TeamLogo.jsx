import React from "react";
import { useGame } from "@/state/GameStore";

/**
 * Mostra o primeiro logo que carregar. Se falhar, tenta o próximo.
 * props: { team, brand?, year, className?, size? (tailwind) }
 */
export default function TeamLogo({ team, brand = null, year, className = "", size = "h-6 w-6", alt }) {
  const getCands = useGame.getState().getTeamLogoCandidates;
  const cands = getCands?.(team, year, brand) || [];
  if (!cands.length) return null;

  return (
    <img
      src={cands[0]}
      alt={alt || team?.team_name || team?.name || "Team logo"}
      className={`${size} object-contain ${className}`}
      onError={(e) => {
        const img = e.currentTarget;
        const list = img.dataset.next ? JSON.parse(img.dataset.next) : cands;
        const next = list.slice(1);
        if (next.length) {
          img.src = next[0];
          img.dataset.next = JSON.stringify(next);
        } else {
          img.style.display = "none";
        }
      }}
      data-next={JSON.stringify(cands)}
    />
  );
}
