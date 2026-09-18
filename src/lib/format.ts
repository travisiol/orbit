/** `0xe06c…d0e7` */
export function shortAddress(address: string, chars = 4): string {
  if (!address || address.length < 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** Base units → number (display only; precision loss is fine here). */
export function toNumber(value: bigint | string, decimals = 18): number {
  return Number(typeof value === "string" ? BigInt(value) : value) / 10 ** decimals;
}

/** `4.2k`, `1.2m`, `980`, `0.0042` */
export function compact(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(digits)}b`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(digits)}m`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(digits)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2);
  if (abs === 0) return "0";
  if (abs < 0.0001) return value.toExponential(1);
  return value.toFixed(4);
}

/** `4.20 eth`, `0.0042 eth` */
export function eth(value: number, digits?: number): string {
  if (!Number.isFinite(value)) return "—";
  if (digits !== undefined) return `${value.toFixed(digits)} eth`;
  if (value === 0) return "0 eth";
  if (value < 0.001) return `${value.toFixed(5)} eth`;
  if (value < 1) return `${value.toFixed(3)} eth`;
  return `${compact(value, 2)} eth`;
}

/** `$18,429` — whole dollars with thousands separators; cents only under $10. */
export function usd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value < 10) return `$${value.toFixed(2)}`;
  if (value < 100) return `$${value.toFixed(1)}`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** A tiny per-token price: `4.2e-9 eth`. */
export function tinyPrice(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0 eth";
  if (value < 0.001) return `${value.toExponential(2)} eth`;
  return `${value.toFixed(4)} eth`;
}

/** `20 395 755` — thin-space thousands, no decimals. */
export function tokenAmount(value: bigint | string, decimals = 18): string {
  const v = (typeof value === "string" ? BigInt(value) : value) / 10n ** BigInt(decimals);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function pct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** `2 min ago`, `3 h ago`, `4 d ago` */
export function ago(unixSeconds: number, now = Date.now() / 1000): string {
  if (!unixSeconds) return "";
  const s = Math.max(0, now - unixSeconds);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** ipfs://cid → a gateway URL; https passes through; empty stays empty. */
export function logoUrl(logo: string): string {
  const v = logo.trim();
  if (!v) return "";
  if (v.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${v.slice(7)}`;
  if (/^https?:\/\//.test(v)) return v;
  if (/^[a-zA-Z0-9]{46,}$/.test(v)) return `https://ipfs.io/ipfs/${v}`;
  return "";
}
