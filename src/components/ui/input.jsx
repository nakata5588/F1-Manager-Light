import React from "react";

function InputBase({ className = "", ...props }) {
  return (
    <input
      className={`w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black ${className}`}
      {...props}
    />
  );
}

// ✅ Default + named
const Input = InputBase;
export default Input;
export { Input };
