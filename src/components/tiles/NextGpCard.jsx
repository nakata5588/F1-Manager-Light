import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card.jsx";
import { daysBetween } from "../../utils/date.js";

export default function NextGpCard({ currentDateISO, gp }) {
  if (!gp) {
    return (
      <Card>
        <CardHeader><CardTitle>Next GP</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-gray-500">No events scheduled.</p></CardContent>
      </Card>
    );
  }
  const daysLeft = daysBetween(currentDateISO, gp.dateISO);
  return (
    <Card>
      <CardHeader><CardTitle>Next GP</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-gray-800">{gp.name}</p>
        <p className="text-xs text-gray-500 mt-1">{gp.dateISO}</p>
        <p className="mt-2 text-sm">
          Starts in <b>{daysLeft}</b> day{daysLeft === 1 ? "" : "s"}.
        </p>
      </CardContent>
    </Card>
  );
}
