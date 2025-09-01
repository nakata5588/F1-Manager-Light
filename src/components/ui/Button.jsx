import React from "react";

export default function Button({ as:Tag="button", className="", children, ...props }) {
  return (
    <Tag
      className={`inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium bg-black text-white hover:opacity-90 active:opacity-80 ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}
