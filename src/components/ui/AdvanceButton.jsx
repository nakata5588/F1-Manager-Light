import React from "react";
import { useGameTime } from "../state/GameTime.jsx";

export default function AdvanceButton({ days = 1 }) {
  const { advanceDays } = useGameTime();
  return <button onClick={() => advanceDays(days)}>Advance +{days}</button>;
}
