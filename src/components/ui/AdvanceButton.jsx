// src/components/ui/AdvanceButton.jsx
import React, { useState } from "react";
import { Button } from "./button";
import { useGame } from "../../state/GameStore";

export default function AdvanceButton({
  className = "",
  style,
  size = "sm",
  children,
  title = "Advance one day (until break)",
  onDone,        // opcional: callback(res) quando terminar
  ...rest
}) {
  const { advanceOneDayUntilBreak } = useGame();
  const [busy, setBusy] = useState(false);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    if (typeof advanceOneDayUntilBreak !== "function") {
      console.error("[AdvanceButton] advanceOneDayUntilBreak is not available from useGame()");
      return;
    }

    setBusy(true);
    try {
      const res = await advanceOneDayUntilBreak(); // suporta sync/async
      console.log("[Advance] OK:", res);
      onDone?.(res);
    } catch (err) {
      console.error("[Advance] FAILED:", err);
      // opcional: algum toast se tiveres
      // toast.error("Advance failed. Check console.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      onClick={handleClick}
      disabled={busy}
      aria-busy={busy ? "true" : "false"}
      className={className}
      style={style}
      title={title}
      {...rest}
    >
      {busy ? "Advancing…" : (children ?? "Advance")}
    </Button>
  );
}
