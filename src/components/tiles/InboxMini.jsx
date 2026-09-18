import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.jsx";
import MessageModal from "../inbox/MessageModal.jsx";
import { useGame } from "../../state/GameStore.js";

export default function InboxMini({ items = [] }) {
  const setGameState = useGame((s)=>s.setGameState);
  const gameState = useGame((s)=>s.gameState);
  const [active,setActive]=useState(null);
  const recent = items.slice(0, 5);

  const openMessage=(m)=>{
    const normalized={
      ...m,
      title:m.title||m.subject||m.headline||"Message",
      date:m.date||m.dateISO||"",
      body:m.body||m.description||"",
      meta:{...m},
    };
    setActive(normalized);
    if(m?.unread===true||m?.read===false){
      const next=(gameState?.inbox||[]).map((x)=>x.id===m.id?{...x,read:true,unread:false}:x);
      setGameState({inbox:next});
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Inbox</CardTitle>
          <Link to="/Inbox" className="text-xs text-blue-600 hover:underline">All messages</Link>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-gray-500">No messages.</p>
          ) : (
            <ul className="text-sm divide-y">
              {recent.map(m => (
                <li key={m.id}>
                  <button type="button" onClick={()=>openMessage(m)} className="py-2 w-full text-left hover:bg-gray-50 rounded px-1">
                    <div className="font-medium truncate">
                      {(m?.unread===true||m?.read===false) && <span className="inline-block h-2 w-2 rounded-full bg-blue-600 mr-2" />}
                      {m.subject||m.title||"Message"}
                    </div>
                    <div className="text-xs text-gray-500">{m.from||m.type||"—"} • {m.date||m.dateISO||"—"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {active && <MessageModal message={active} onClose={()=>setActive(null)} />}
    </>
  );
}
