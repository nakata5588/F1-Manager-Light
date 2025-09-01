// src/components/Topbar.jsx
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { Link, useNavigate } from "react-router-dom";

export default function Topbar() {
  const navigate = useNavigate();
  const { gameState, quickSave, saveGame, getLastSaveKey, loadFromKey } = useGame();
  const [openSaveAs, setOpenSaveAs] = useState(false);
  const [saveName, setSaveName] = useState("");
  const saveAsRef = useRef(null);

  useEffect(() => {
    // preenche nome por defeito
    setSaveName(defaultName(gameState));
  }, [gameState]);

  // Ctrl/Cmd+S -> Quick Save
  useEffect(() => {
    const onKey = (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleQuickSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleQuickSave() {
    const res = quickSave();
    toastMini(`Saved: ${res.meta.name}`);
  }
  function handleSaveAs() {
    const res = saveGame({ name: (saveName || "").trim() || defaultName(gameState) });
    setOpenSaveAs(false);
    toastMini(`Saved: ${res.meta.name}`);
  }
  function handleContinue() {
    const key = getLastSaveKey();
    if (!key) return;
    const gs = loadFromKey(key);
    if (gs) navigate("/");
  }

  const lastSaveKey = getLastSaveKey();
  const canContinue = Boolean(lastSaveKey);

  return (
    <div className="w-full border-b bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-[1200px] mx-auto px-3 py-2 flex items-center gap-2">
        <Link to="/" className="font-semibold mr-2">F1 Manager Light</Link>

        {/* Botões principais */}
        <Button size="sm" variant="outline" disabled>New</Button>

        <div className="relative">
          <Button size="sm" onClick={handleQuickSave}>Save</Button>
        </div>

        <div className="relative">
          <Button size="sm" variant="outline" onClick={() => setOpenSaveAs(v => !v)}>Save As…</Button>
          {openSaveAs && (
            <div
              ref={saveAsRef}
              className="absolute z-40 mt-1 p-2 bg-background border rounded-lg shadow w-64"
            >
              <div className="text-xs text-muted-foreground mb-1">Save name</div>
              <input
                type="text"
                value={saveName}
                onChange={(e)=>setSaveName(e.target.value)}
                className="border rounded px-2 py-1 w-full"
                placeholder="Save name"
              />
              <div className="flex items-center justify-end gap-2 mt-2">
                <Button size="sm" variant="outline" onClick={()=>setOpenSaveAs(false)}>Cancel</Button>
                <Button size="sm" onClick={handleSaveAs}>Save</Button>
              </div>
            </div>
          )}
        </div>

        <Link to="/load"><Button size="sm" variant="outline">Load</Button></Link>

        <Button size="sm" variant="outline" onClick={handleContinue} disabled={!canContinue}>
          Continue
        </Button>

        {/* Espaçador */}
        <div className="flex-1" />

        {/* Estado rápido (team/season) */}
        <div className="text-xs text-muted-foreground">
          {gameState?.team?.team_name || gameState?.team?.name || "—"}
          {gameState?.seasonYear ? ` • ${gameState.seasonYear}` : ""}
        </div>
      </div>
    </div>
  );
}

function defaultName(gs) {
  const team = gs?.team?.team_name || gs?.team?.name || "Save";
  const season = gs?.seasonYear || "";
  return `${team}${season ? ` — ${season}` : ""}`;
}

function toastMini(msg) {
  // sem libs: micro-toast com alert, troca por um toast real se tiveres
  // eslint-disable-next-line no-console
  console.log("[SAVE]", msg);
}
