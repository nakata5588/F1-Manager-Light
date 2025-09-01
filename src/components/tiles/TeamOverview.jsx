import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.jsx";

export default function TeamOverview({ team }) {
  return (
    <Card>
      <CardHeader><CardTitle>Team Overview</CardTitle></CardHeader>
      <CardContent>
        <div className="text-sm">
          <div><span className="text-gray-500">Team:</span> {team?.name ?? "—"}</div>
          <div className="mt-1">
            <span className="text-gray-500">Budget:</span> {team?.budget != null ? `$${team.budget.toLocaleString()}` : "—"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
