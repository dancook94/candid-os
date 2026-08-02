"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

type ClickableTableRowProps = {
  href: string;
  children: ReactNode;
};

export function ClickableTableRow({ href, children }: ClickableTableRowProps) {
  const router = useRouter();

  return (
    <tr
      className="cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/30"
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(href);
        }
      }}
      tabIndex={0}
      role="link"
    >
      {children}
    </tr>
  );
}
