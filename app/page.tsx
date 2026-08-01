import Image from "next/image";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
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
            width={240}
            height={117}
            priority
            className="mx-auto h-auto w-[min(240px,75vw)] lg:mx-0"
          />

          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Candid OS
          </p>

          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem] lg:leading-[1.05]">
            Your Candid customer portal
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
            View quotations, submit new requests and track your projects with
            Candid Creative.
          </p>
        </section>

        <section className="flex w-full flex-col justify-center lg:max-w-md lg:flex-none xl:max-w-lg">
          <div className="public-auth-panel">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                Get started
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Sign in to an existing account or register for access to quote
                requests and project updates.
              </p>
            </div>

            <div className="mt-8 space-y-3">
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "h-11 w-full text-base"
                )}
              >
                Login
              </Link>

              <Link
                href="/register"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "h-11 w-full text-base"
                )}
              >
                Register
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Secure access for Candid Creative customers.
          </p>
        </section>
      </div>
    </main>
  );
}
