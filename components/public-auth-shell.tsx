import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PublicAuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function PublicAuthShell({
  title,
  description,
  children,
  footer,
  className,
}: PublicAuthShellProps) {
  return (
    <main className="public-auth-page">
      <div
        className="public-auth-glow pointer-events-none absolute inset-0"
        aria-hidden
      />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-10 lg:min-h-[calc(100vh-8rem)] lg:flex-row lg:items-center lg:gap-16">
        <section className="flex flex-1 flex-col justify-center text-center lg:text-left">
          <Image
            src="/LOGO_YELLOW.svg"
            alt="Candid Creative"
            width={220}
            height={108}
            priority
            className="mx-auto h-auto w-[min(220px,72vw)] lg:mx-0"
          />

          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Candid OS
          </p>

          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {title}
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
            {description}
          </p>
        </section>

        <section
          className={cn(
            "flex w-full flex-col justify-center lg:max-w-md lg:flex-none xl:max-w-lg",
            className
          )}
        >
          <div className="public-auth-panel">{children}</div>

          {footer ? (
            <div className="mt-6 text-center text-sm text-muted-foreground">
              {footer}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
