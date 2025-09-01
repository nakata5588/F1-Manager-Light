import React from "react";

export function Card({ className = "", children }) {
  return <div className={`bg-white rounded-xl shadow ${className}`}>{children}</div>;
}

export function CardHeader({ className = "", children }) {
  return <div className={`px-4 pt-4 ${className}`}>{children}</div>;
}

export function CardTitle({ className = "", children }) {
  return <h3 className={`text-base font-semibold ${className}`}>{children}</h3>;
}

export function CardContent({ className = "", children }) {
  return <div className={`px-4 pb-4 ${className}`}>{children}</div>;
}
