/**
 * The name lives here and nowhere else. Change it once to rebrand.
 */
export const site = {
  name: "ORBIT",
  wordmark: "ORBIT",
  slug: "orbit",
  ticker: "ORBIT",
  hook: "The market is a universe.",
  tagline: "Own the financial system.",
  description:
    "The market as a solar system on Robinhood Chain. The Sun is the treasury, every planet is an asset — NVDA, AAPL, GOLD, TSLA, META, and any other anyone lights. Choose your planet; every trade of $ORBIT feeds the Sun, and the Sun pays you in the asset you orbit.",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://orbit.example").replace(/\/$/, ""),
  x: process.env.NEXT_PUBLIC_X_URL ?? "",
  ponsTokenUrl: (token: string) => `https://www.ponsfamily.com/launchpad/${token}`,
} as const;
