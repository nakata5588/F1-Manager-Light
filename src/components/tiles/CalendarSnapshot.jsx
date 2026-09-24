import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.jsx";
import { GrandPrixFlag } from "../entity/GrandPrixFlag.jsx";

export default function CalendarSnapshot({ calendar = [], currentRound = 0 }) {
  // Mostra as próximas 5 provas a partir do round atual
  const slice = Array.isArray(calendar) ? calendar.slice(currentRound, currentRound + 5) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar (Next)</CardTitle>
      </CardHeader>
      <CardContent>
        {slice.length === 0 ? (
          <p className="text-sm text-gray-500">Empty.</p>
        ) : (
          <ul className="text-sm divide-y">
            {slice.map((gp, i) => {
              const key = String(
                gp.gp_id ??
                gp.track_id ??
                gp.id ??
                gp.date ??
                `${gp.name}-${i}`
              );
              return (
                <li key={key} className="py-2 flex justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <GrandPrixFlag gp={gp} size="sm"/>
                    <span className="truncate">{gp.name || gp.gp_name || "Grand Prix"}</span>
                  </span>
                  <span className="text-gray-500 shrink-0">
                    {gp.dateISO || gp.date || gp.race_date || "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
