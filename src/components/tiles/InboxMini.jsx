import React from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.jsx";

export default function InboxMini({ items = [] }) {
  const recent = items.slice(0, 5);
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Inbox</CardTitle>
        <Link to="/Inbox" className="text-xs text-blue-600 hover:underline">Open</Link>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500">No messages.</p>
        ) : (
          <ul className="text-sm divide-y">
            {recent.map(m => (
              <li key={m.id} className="py-2">
                <div className="font-medium truncate">{m.subject}</div>
                <div className="text-xs text-gray-500">{m.from} • {m.date}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
