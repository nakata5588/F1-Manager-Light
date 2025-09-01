import React from "react";

// Estado controlado externamente via props.value / onValueChange
function Select({ value, onValueChange, children }) {
  // O Select em si só atua como provider; não renderiza nada por si
  return <div data-select value={value} onValueChange={onValueChange}>{children}</div>;
}

function SelectTrigger({ children, ...props }) {
  return <div {...props}>{children}</div>;
}

function SelectValue({ placeholder }) {
  return <span>{placeholder}</span>;
}

function SelectContent({ children }) {
  return <div className="relative">{children}</div>;
}

function SelectItem({ value, children }) {
  // versão simples: um botão que “seleciona” o valor
  return (
    <button
      type="button"
      className="block w-full px-3 py-2 text-left hover:bg-gray-100"
      onClick={(e) => {
        // sobe até ao wrapper com onValueChange
        let parent = e.currentTarget.parentElement;
        while (parent && parent.getAttribute("data-select") == null) parent = parent.parentElement;
        const currentValue = parent?.getAttribute("value");
        const onValueChange = parent?.getAttribute("onValueChange");
        // fallback direto via React prop: procura o React fiber prop
        const reactProps = parent?._owner?.pendingProps || parent?._reactProps || {};
        if (typeof reactProps.onValueChange === "function") {
          reactProps.onValueChange(value);
        }
      }}
    >
      {children}
    </button>
  );
}

// ✅ Default + named (default = Select)
export default Select;
export { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
