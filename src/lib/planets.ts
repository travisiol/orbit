/**
 * The catalog: assets the site has checked and can offer as planets. Anyone
 * may light a planet for ANY 18-decimal token on the chain straight from
 * the Sun contract; this table only says which ones we looked at — it is
 * how the sky knows a planet's look, its slug, and whether to mark it
 * "verified". It is the single source for the site AND the contract
 * scripts (fork-check, serve-fork import it), so it stays free of browser
 * or viem imports.
 *
 * Assets are Robinhood's own stock tokens on Robinhood Chain, read from the
 * chain on 2026-09-18 (`symbol()` / `name()` "… • Robinhood Token", 18
 * decimals). HOOD has none: Robinhood has not tokenized its own stock, and
 * the two "HOOD" contracts on the chain are memecoins with 1M / 1B supply.
 * Its entry keeps the brief's place in the sky as a dark candidate that
 * cannot be deployed until an issuance exists.
 *
 * Pyth ids are the 24/7 `Equity.Index.X/USD` feeds where they exist, else
 * the market-hours `Equity.US.X/USD` feed (the wind then only blows while
 * the stock trades).
 */
export type Candidate = {
  symbol: string;
  name: string;
  issuer: string;
  slug: string;
  /** Zero address = no native token exists (HOOD). */
  asset: `0x${string}`;
  pythId: `0x${string}`;
  /** The feed publishes around the clock (Equity.Index) or only in market hours (Equity.US). */
  feed: "24/7" | "market hours" | "none";
  /** Which procedural surface the renderer paints. */
  surface: Surface;
  /** Named by the brief: shown in the sky as a candidate before anyone lights it. */
  brief: boolean;
  line: string;
};

export type Surface = "basalt" | "chrome" | "slate" | "porcelain" | "circuit" | "gold" | "silver" | "marble" | "ice" | "ember";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export const ETH_PRICE_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" as const;

/** The brief's six first, in the brief's order, then the rest of what exists. */
export const CATALOG: readonly Candidate[] = [
  {
    symbol: "NVDA",
    name: "NVIDIA",
    issuer: "NVIDIA Corporation",
    slug: "nvda",
    asset: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    pythId: "0xa470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852",
    feed: "24/7",
    surface: "circuit",
    brief: true,
    line: "Dark silicon, lit from within.",
  },
  {
    symbol: "AAPL",
    name: "Apple",
    issuer: "Apple Inc.",
    slug: "aapl",
    asset: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    pythId: "0xaaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36",
    feed: "24/7",
    surface: "porcelain",
    brief: true,
    line: "White porcelain.",
  },
  {
    symbol: "GLD",
    name: "Gold",
    issuer: "SPDR Gold Trust",
    slug: "gold",
    asset: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e",
    pythId: "0xe190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca",
    feed: "market hours",
    surface: "gold",
    brief: true,
    line: "Hammered gold. Paid in GLD.",
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    issuer: "Tesla, Inc.",
    slug: "tsla",
    asset: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    pythId: "0xe6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0",
    feed: "24/7",
    surface: "chrome",
    brief: true,
    line: "Brushed steel.",
  },
  {
    symbol: "HOOD",
    name: "Robinhood",
    issuer: "Robinhood Markets, Inc.",
    slug: "hood",
    asset: ZERO_ADDRESS,
    pythId: "0x4a4f96283d157d08b7b8aa596363f7978587d4fa59a77dcb90f84af7d870a630",
    feed: "24/7",
    surface: "basalt",
    brief: true,
    line: "The chain's own stock. Not tokenized on its own chain — dark until it is.",
  },
  {
    symbol: "META",
    name: "Meta",
    issuer: "Meta Platforms, Inc.",
    slug: "meta",
    asset: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
    pythId: "0x2cc0c022f7f37920485a5947f3cea8633783b6cb7fff6d94ee52f48687b7783d",
    feed: "24/7",
    surface: "slate",
    brief: true,
    line: "Slate under pale cloud bands.",
  },
  // ── beyond the brief: every other Robinhood stock token found on the chain, with a Pyth feed
  { symbol: "SPY", name: "S&P 500", issuer: "SPDR S&P 500 ETF Trust", slug: "spy", asset: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", pythId: "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5", feed: "market hours", surface: "marble", brief: false, line: "Five hundred companies in one marble." },
  { symbol: "QQQ", name: "Nasdaq 100", issuer: "Invesco QQQ Trust", slug: "qqq", asset: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", pythId: "0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d", feed: "market hours", surface: "ice", brief: false, line: "A hundred names under ice." },
  { symbol: "GOOGL", name: "Alphabet", issuer: "Alphabet Inc. (Class A)", slug: "googl", asset: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", pythId: "0xad519718d387de4f0d7d29ea16a3730ce42e49c59fef6fba6fc9bac477645f6f", feed: "24/7", surface: "marble", brief: false, line: "Pale marble, veined." },
  { symbol: "PLTR", name: "Palantir", issuer: "Palantir Technologies Inc.", slug: "pltr", asset: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", pythId: "0x52c7c6b70032b7151c8d0febf684f14318e1e13315976e171267639955400bb9", feed: "24/7", surface: "circuit", brief: false, line: "Traces in the dark." },
  { symbol: "MU", name: "Micron", issuer: "Micron Technology, Inc.", slug: "mu", asset: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", pythId: "0x27e65b49e4572601374c5bde284411c20f49eb74845cc7f7801f9d27fba2b4b2", feed: "24/7", surface: "chrome", brief: false, line: "Wafer chrome." },
  { symbol: "INTC", name: "Intel", issuer: "Intel Corporation", slug: "intc", asset: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", pythId: "0xcecbc86ad1adfa72b78b573375dc36eb4664e096252c0a3e55e625ea838685f1", feed: "24/7", surface: "slate", brief: false, line: "Old silicon, slate grey." },
  { symbol: "LLY", name: "Eli Lilly", issuer: "Eli Lilly and Company", slug: "lly", asset: "0x8005d266423c7ea827372c9c864491e5786600ea", pythId: "0x70dcf5fd56553d0023693e4b590336a8c9bcfd0d98dd9f093b1f697820d98325", feed: "market hours", surface: "porcelain", brief: false, line: "Pharmaceutical white." },
  { symbol: "SNAP", name: "Snap", issuer: "Snap Inc.", slug: "snap", asset: "0xF6589F11Bc40b669e584073F428B05562F568733", pythId: "0xa23dd397c4f7a2187d00c1973e58ff6e8a681658b1105d1bd42a8fccbbd068f7", feed: "market hours", surface: "ember", brief: false, line: "A small ember." },
  { symbol: "SGOV", name: "T-Bills", issuer: "iShares 0-3 Month Treasury Bond ETF", slug: "sgov", asset: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5", pythId: "0x8d6a29bb5ed522931d711bb12c4bbf92af986936e52af582032913b5ffcbf4d5", feed: "market hours", surface: "ice", brief: false, line: "The cold planet: three-month bills." },
  { symbol: "SLV", name: "Silver", issuer: "iShares Silver Trust", slug: "slv", asset: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f", pythId: "0x6fc08c9963d266069cbd9780d98383dabf2668322a5bef0b9491e11d67e5d7e7", feed: "market hours", surface: "silver", brief: false, line: "Hammered silver. Paid in SLV." },
];

export const BRIEF = CATALOG.filter((c) => c.brief);

export function candidateBySlug(slug: string): Candidate | undefined {
  return CATALOG.find((c) => c.slug === slug);
}

export function candidateByAsset(asset: string): Candidate | undefined {
  const a = asset.toLowerCase();
  return CATALOG.find((c) => c.asset.toLowerCase() === a && c.asset !== ZERO_ADDRESS);
}

/** A planet lit for an asset the catalog does not know gets a surface from its address. */
export function surfaceFor(asset: string): Surface {
  const pool: Surface[] = ["basalt", "chrome", "slate", "porcelain", "marble", "ice", "ember", "silver"];
  let h = 0;
  for (let i = 2; i < asset.length; i++) h = (h * 31 + asset.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

/** Mirror of Sun.periodFor: the k-th planet locks (k + 1) × 7 days, at most 91. */
export function periodForIndex(idx: number): number {
  return Math.min(91, 7 * (idx + 1)) * 86_400;
}

/** Distance from the Sun of the k-th orbit, in scene units. */
export function orbitRadiusFor(idx: number): number {
  return 3.4 + 1.55 * idx;
}
