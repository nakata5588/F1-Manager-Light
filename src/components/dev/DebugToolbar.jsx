// src/components/dev/DebugToolbar.jsx
import { useState } from "react";
import { useGame } from "@/state/GameStore";

export default function DebugToolbar() {
  const { gameState, fastForwardDays, fastForwardToNextGP, advanceOneDayUntilBreak } = useGame();
  const [nDays, setNDays] = useState(7);

  // só mostra se tiver ativado via settings.developer.showDevTools
  if (!gameState?.settings?.developer?.showDevTools) return null;

  return (
    <div style={{
      position: "fixed", right: 12, bottom: 12, zIndex: 9999,
      background: "rgba(20,20,20,0.9)", color: "#fff", padding: 12,
      borderRadius: 12, boxShadow: "0 6px 18px rgba(0,0,0,0.35)", fontFamily: "Inter, system-ui, sans-serif"
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>🧪 Debug</div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button onClick={() => advanceOneDayUntilBreak()} style={btn}>+1 dia</button>
        <input
          type="number"
          value={nDays}
          onChange={e => setNDays(Number(e.target.value) || 1)}
          style={{
            width: 60, padding: 6, borderRadius: 8, border: "1px solid #444",
            background: "#111", color: "#fff"
          }}
        />
        <button onClick={() => fastForwardDays(nDays)} style={btn}>Avançar N dias</button>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => fastForwardToNextGP()} style={btn}>Ir ao próximo GP</button>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
        Data: <b>{(gameState.currentDateISO || "").slice(0,10)}</b> • Ronda: <b>{(gameState.currentRound+1)}</b>
        <br/>Inbox: <b>{gameState.inbox?.length || 0}</b> • Budget: <b>{(gameState.team?.budget ?? 0).toLocaleString()}</b>
      </div>
    </div>
  );
}

const btn = {
  background: "#2d72ff", color: "#fff", border: "none",
  padding: "8px 12px", borderRadius: 10, cursor: "pointer"
};
