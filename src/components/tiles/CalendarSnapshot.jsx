import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card.jsx";

export default function CalendarSnapshot({ calendar = [], currentRound = 0 }) {
  const slice = calendar.slice(currentRound, currentRound + 5);
  return (
    <Card>
      <CardHeader><CardTitle>Calendar (Next)</CardTitle></CardHeader>
      <CardContent>
        {slice.length === 0 ? (
          <p className="text-sm text-gray-500">Empty.</p>
        ) : (
          <ul className="text-sm divide-y">
            {slice.map(gp => (
              <li key={gp.id} className="py-2 flex justify-between gap-3">
                <span className="truncate">{gp.name}</span>
                <span className="text-gray-500 shrink-0">{gp.dateISO}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
