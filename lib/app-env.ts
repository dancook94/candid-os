export function isTestAppEnvironment(): boolean {
  return process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase() === "test";
}
