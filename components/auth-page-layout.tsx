import type { ReactNode } from "react";

import { PublicAuthShell } from "@/components/public-auth-shell";

type AuthPageLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthPageLayout({
  title,
  description,
  children,
  footer,
}: AuthPageLayoutProps) {
  return (
    <PublicAuthShell title={title} description={description} footer={footer}>
      {children}
    </PublicAuthShell>
  );
}
