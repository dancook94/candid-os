import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TestEnvironmentBanner } from "@/components/test-environment-indicator";
import { isTestAppEnvironment } from "@/lib/app-env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const testEnvironment = isTestAppEnvironment();

export const metadata: Metadata = {
  title: testEnvironment ? "Candid OS — TEST" : "Candid OS",
  description: "Candid Creative customer and admin portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-app-env={testEnvironment ? "test" : undefined}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TestEnvironmentBanner />
        {children}
      </body>
    </html>
  );
}
