import React from "react";

/**
 * Slider component
 *
 * Props:
 * - value: [number] (array de 1 elemento, tal como no CreateTeam.jsx)
 * - min: número mínimo
 * - max: número máximo
 * - step: incremento
 * - onValueChange: callback que recebe array [number]
 * - className: classes extras (opcional)
 */
export default function Slider({
  value = [0],
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  className = "",
}) {
  const current = Array.isArray(value) ? value[0] : Number(value) || 0;

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={current}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (onValueChange) onValueChange([v]);
      }}
      className={`w-full accent-blue-500 ${className}`}
    />
  );
}
