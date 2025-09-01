import React from "react";

function ButtonBase({ variant = "default", className = "", children, ...props }) {
  const variants = {
    default: "bg-black text-white hover:opacity-90",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
    outline: "border border-gray-300 text-gray-900 bg-white hover:bg-gray-50",
    destructive: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button
      className={`inline-flex items-center px-3 py-2 rounded-md text-sm ${variants[variant] || variants.default} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// ✅ Exporta default e named (ambos “Button”)
const Button = ButtonBase;
export default Button;
export { Button };
