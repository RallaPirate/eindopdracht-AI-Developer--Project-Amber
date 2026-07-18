"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Win95ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  underlinedChar?: string;
};

export function Win95Button({
  children,
  underlinedChar,
  className = "",
  type = "button",
  ...props
}: Win95ButtonProps) {
  let content: ReactNode = children;

  if (underlinedChar && typeof children === "string") {
    const index = children.toLowerCase().indexOf(underlinedChar.toLowerCase());
    if (index >= 0) {
      content = (
        <>
          {children.slice(0, index)}
          <span className="underline">{children[index]}</span>
          {children.slice(index + 1)}
        </>
      );
    }
  }

  return (
    <button
      type={type}
      className={`os-bevel-button px-3 py-1 text-sm outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-4px] focus-visible:outline-black disabled:cursor-default ${className}`}
      {...props}
    >
      {content}
    </button>
  );
}
