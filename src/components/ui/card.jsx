import React from "react";

/** Container principal do cartão */
function CardBase({ className = "", children, ...props }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow ${className}`} {...props}>
      {children}
    </div>
  );
}

/** Header do cartão (título, subtítulo, etc.) */
function CardHeader({ className = "", children, ...props }) {
  return (
    <div className={`p-4 border-b border-gray-100 ${className}`} {...props}>
      {children}
    </div>
  );
}

/** Título do cartão */
function CardTitle({ className = "", children, as: As = "h3", ...props }) {
  return (
    <As className={`text-base font-semibold leading-6 ${className}`} {...props}>
      {children}
    </As>
  );
}

/** Descrição/subtítulo do cartão */
function CardDescription({ className = "", children, ...props }) {
  return (
    <p className={`mt-1 text-sm text-gray-500 ${className}`} {...props}>
      {children}
    </p>
  );
}

/** Conteúdo do cartão */
function CardContent({ className = "", children, ...props }) {
  return (
    <div className={`p-4 ${className}`} {...props}>
      {children}
    </div>
  );
}

/** Footer/área de ações do cartão */
function CardFooter({ className = "", children, ...props }) {
  return (
    <div className={`p-4 border-t border-gray-100 ${className}`} {...props}>
      {children}
    </div>
  );
}

/** Exports: default + named */
const Card = CardBase;
export default Card;
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
