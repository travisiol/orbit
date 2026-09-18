/**
 * Quotes for the Pons V2 curve, in bigint base units. The curve is an exact
 * constant product on (quote reserve incl. the phantom liquidity, token
 * reserve). Checked to the wei on a fork of Robinhood Chain against the
 * real factory (contracts/scripts/fork-check.ts): 0.01 ETH on a fresh ETH
 * curve → 5 858 334.812710811290608911 tokens; 0.1 GLD on a fresh gold
 * curve → 8 923 170.036623831801287295. Fees come off the input on a buy
 * and off the output on a sell.
 */

export const BPS = 10_000n;

/** Phantom quote on a native-ETH curve; stock-paired curves carry their own. */
export const ETH_PHANTOM_QUOTE = 1_680_000_000_000_000_000n;
/** Launch supply on every curve seen so far: 1e9 tokens. */
export const LAUNCH_SUPPLY = 1_000_000_000n * 10n ** 18n;

/** Tokens out for `amountIn`, after `feeBps` + `extraBps` (creator tax, snipe tax) are taken from the input. */
export function quoteBuy(quote: bigint, tokens: bigint, amountIn: bigint, feeBps: bigint, extraBps = 0n): bigint {
  if (amountIn <= 0n || quote <= 0n || tokens <= 0n) return 0n;
  const taken = feeBps + extraBps;
  if (taken >= BPS) return 0n;
  const net = amountIn - (amountIn * taken) / BPS;
  return (tokens * net) / (quote + net);
}

/** Quote out for `tokensIn`, after `feeBps` + `extraBps` are taken from the output. */
export function quoteSell(quote: bigint, tokens: bigint, tokensIn: bigint, feeBps: bigint, extraBps = 0n): bigint {
  if (tokensIn <= 0n || quote <= 0n || tokens <= 0n) return 0n;
  const taken = feeBps + extraBps;
  if (taken >= BPS) return 0n;
  const gross = (quote * tokensIn) / (tokens + tokensIn);
  return gross - (gross * taken) / BPS;
}

/** Spot price in quote base units per whole token (1e18 units). */
export function spotPerToken(quote: bigint, tokens: bigint): bigint {
  if (tokens === 0n) return 0n;
  return (quote * 10n ** 18n) / tokens;
}

/** Market cap in quote base units: spot × launch supply. */
export function marketCap(quote: bigint, tokens: bigint, supply: bigint): bigint {
  if (tokens === 0n) return 0n;
  return (quote * supply) / tokens;
}

/** How far a buy moves the spot price, in bps. */
export function buyImpactBps(quote: bigint, tokens: bigint, amountIn: bigint, tokensOut: bigint): bigint {
  if (quote <= 0n || tokens <= 0n || tokens <= tokensOut) return 0n;
  const before = (quote * BPS * 10n ** 18n) / tokens;
  const after = ((quote + amountIn) * BPS * 10n ** 18n) / (tokens - tokensOut);
  return before === 0n ? 0n : ((after - before) * BPS) / before;
}

/** How far a sell drops the spot price, in bps (positive). */
export function sellImpactBps(quote: bigint, tokens: bigint, tokensIn: bigint): bigint {
  if (quote <= 0n || tokens <= 0n || tokensIn <= 0n) return 0n;
  const gross = (quote * tokensIn) / (tokens + tokensIn);
  const before = (quote * BPS * 10n ** 18n) / tokens;
  const after = ((quote - gross) * BPS * 10n ** 18n) / (tokens + tokensIn);
  return before === 0n ? 0n : ((before - after) * BPS) / before;
}

/** `out` less `slippageBps`, the floor passed to the curve. */
export function withSlippage(out: bigint, slippageBps: bigint): bigint {
  return (out * (BPS - slippageBps)) / BPS;
}

/** "0.05" → base units, tolerant of a trailing dot; null when not a number. */
export function parseDecimal(value: string, decimals = 18): bigint | null {
  const v = value.trim();
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [whole = "0", frac = ""] = v.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

/** Base units → decimal string with up to `digits` fractional digits, trailing zeros trimmed. */
export function formatUnitsTrim(value: bigint, decimals = 18, digits = 6): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const whole = v / 10n ** BigInt(decimals);
  const frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
