"use client";

import Link from "next/link";
import { useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { useReadContracts } from "wagmi";
import { DeployPlanet } from "@/components/planet/DeployPlanet";
import { SUN_CONSTANTS } from "@/lib/contracts";
import { explorer } from "@/lib/chain";
import { shortAddress, toNumber } from "@/lib/format";
import { CATALOG, ZERO_ADDRESS, type Candidate } from "@/lib/planets";
import { erc20Abi } from "@/lib/ponsAbi";
import { useSystem } from "@/lib/systemStore";

type Feed = { id: string; symbol: string; description: string };

/**
 * Light a planet: pick a checked asset from the catalog, or bring any
 * 18-decimal token on the chain with its Pyth feed. The Sun reads the
 * token's symbol and name itself; the site only helps find the feed
 * (Hermes' public feed list, no key needed) and shows what it can check.
 */
export function LightPlanet() {
  const system = useSystem();
  const lit = new Set(system.planets.map((p) => p.asset.toLowerCase()));
  const candidates = CATALOG.filter((c) => c.asset !== ZERO_ADDRESS && !lit.has(c.asset.toLowerCase()));
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [custom, setCustom] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="sheet" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <span className="eyebrow">step 3 · planets</span>
          <span className="eyebrow" style={{ color: system.planets.length ? "var(--up)" : "var(--gold)" }}>
            {system.planets.length} / {SUN_CONSTANTS.maxPlanets} lit
          </span>
        </div>
        <p className="prose" style={{ margin: 0, fontSize: 14 }}>
          A planet is an asset the Sun pays in. Anyone lights one for {toNumber(SUN_CONSTANTS.planetFee).toFixed(2)} ETH; it takes the next orbit out (the k-th planet locks its orbits for (k + 1) × 7 days, at most 91) and is permanent. The token must be a contract with 18 decimals that no planet pays in yet.
        </p>

        <div className="seg" role="tablist" aria-label="Which asset">
          <button type="button" role="tab" aria-selected={!custom} data-on={custom ? "0" : "1"} onClick={() => setCustom(false)}>
            checked assets
          </button>
          <button type="button" role="tab" aria-selected={custom} data-on={custom ? "1" : "0"} onClick={() => setCustom(true)}>
            any token
          </button>
        </div>

        {!custom ? (
          <>
            {candidates.length === 0 ? (
              <p className="note" style={{ margin: 0 }}>Every checked asset is lit. Bring another token.</p>
            ) : (
              <div className="pick-list" role="listbox" aria-label="Candidates">
                {candidates.map((c) => (
                  <button key={c.slug} type="button" role="option" aria-selected={picked?.slug === c.slug} data-on={picked?.slug === c.slug ? "1" : "0"} onClick={() => setPicked(c)}>
                    <span className="mono" style={{ fontSize: 12, letterSpacing: "0.14em" }}>{c.symbol}</span>
                    <span style={{ color: "var(--ink-2)", fontSize: 13 }}>{c.issuer}</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.08em" }}>
                      {shortAddress(c.asset, 4)} · pyth {c.feed}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {picked && lit.has(picked.asset.toLowerCase()) && (
              <p className="note" style={{ margin: 0, color: "var(--up)" }}>
                {picked.symbol} is lit — it is in the sky now.{" "}
                <Link href={`/${picked.slug}`} style={{ color: "var(--ink)" }}>
                  enter {picked.name} →
                </Link>
              </p>
            )}
            {picked && !lit.has(picked.asset.toLowerCase()) && (
              <>
                <p className="note" style={{ margin: 0 }}>
                  <b>{picked.name}</b> — {picked.line} Verified 2026-09-18: <code>name()</code> ends in “• Robinhood Token”, 18 decimals. Feed {picked.pythId.slice(0, 10)}… ({picked.feed}).
                </p>
                <DeployPlanet candidate={picked} slot={system.planets.length} />
              </>
            )}
          </>
        ) : (
          <CustomPlanet />
        )}
      </div>
    </div>
  );
}

function CustomPlanet() {
  const system = useSystem();
  const [assetInput, setAssetInput] = useState("");
  const [feedInput, setFeedInput] = useState("");
  const [query, setQuery] = useState("");
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [searching, setSearching] = useState(false);
  const asset = isAddress(assetInput.trim()) ? (assetInput.trim() as Address) : null;
  const feedOk = /^0x[0-9a-fA-F]{64}$/.test(feedInput.trim());

  const token = useReadContracts({
    contracts: asset
      ? [
          { address: asset, abi: erc20Abi, functionName: "symbol" },
          { address: asset, abi: erc20Abi, functionName: "name" },
          { address: asset, abi: erc20Abi, functionName: "decimals" },
        ]
      : [],
    allowFailure: true,
    query: { enabled: Boolean(asset) },
  });
  const symbol = token.data?.[0]?.result as string | undefined;
  const name = token.data?.[1]?.result as string | undefined;
  const decimals = token.data?.[2]?.result as number | undefined;
  const isToken = Boolean(symbol && decimals !== undefined);
  const robinhood = Boolean(name && /•\s*Robinhood Token\s*$/i.test(name));
  const already = asset ? system.planets.some((p) => p.asset.toLowerCase() === asset.toLowerCase()) : false;

  async function search() {
    const q = (query || symbol || "").trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(`https://hermes.pyth.network/v2/price_feeds?query=${encodeURIComponent(q)}&asset_type=equity`);
      const list = (await res.json()) as { id: string; attributes: { symbol: string; description: string } }[];
      setFeeds(list.map((f) => ({ id: `0x${f.id}`, symbol: f.attributes.symbol, description: f.attributes.description })).slice(0, 12));
    } catch {
      setFeeds([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="field">
        <label htmlFor="asset">asset · token address on robinhood chain</label>
        <input id="asset" value={assetInput} onChange={(e) => setAssetInput(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
      </div>
      {asset && (
        <p className="note" style={{ margin: 0 }}>
          {token.isPending ? (
            "reading the token…"
          ) : isToken ? (
            <>
              <b>{symbol}</b> · {name} · {decimals} decimals{" "}
              {decimals !== 18 && <span className="err">— the Sun refuses anything but 18.</span>}
              {already && <span className="err"> — already a planet.</span>}
              <br />
              {robinhood ? <span style={{ color: "var(--up)" }}>name ends in “• Robinhood Token”.</span> : <span className="warn">not named like a Robinhood stock token — anyone can deploy a token; check who issued this one.</span>}{" "}
              <a href={explorer.token(asset)} target="_blank" rel="noreferrer" style={{ color: "var(--ink-2)" }}>
                explorer ↗
              </a>
            </>
          ) : (
            <span className="err">no ERC-20 answers at this address.</span>
          )}
        </p>
      )}
      <div className="field">
        <label htmlFor="feed">pyth price feed id · 32 bytes</label>
        <input id="feed" value={feedInput} onChange={(e) => setFeedInput(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <div className="field">
          <label htmlFor="q">find a feed · symbol</label>
          <input id="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={symbol ?? "NVDA"} autoComplete="off" />
        </div>
        <button type="button" className="btn" disabled={searching} onClick={search}>
          {searching ? "searching…" : "search hermes"}
        </button>
      </div>
      {feeds && (
        <div className="pick-list" role="listbox" aria-label="Feeds">
          {feeds.length === 0 && <p className="note" style={{ margin: 0 }}>no equity feed matches.</p>}
          {feeds.map((f) => (
            <button key={f.id} type="button" role="option" aria-selected={feedInput === f.id} data-on={feedInput === f.id ? "1" : "0"} onClick={() => setFeedInput(f.id)}>
              <span className="mono" style={{ fontSize: 12 }}>{f.symbol}</span>
              <span style={{ color: "var(--ink-2)", fontSize: 13 }}>{f.description}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                {f.id.slice(0, 14)}… {f.symbol.startsWith("Equity.Index") ? "· 24/7" : "· market hours"}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="note" style={{ margin: 0 }}>
        The feed prices the asset in USD for the solar wind. Pair a token with the wrong feed and the wind pays the wrong price — to the planet&apos;s own fillers, from the planet&apos;s own ETH. The Sun cannot check this; you are lighting a planet others will trust.
      </p>
      {asset && feedOk && isToken && decimals === 18 && !already && <DeployPlanet asset={asset} pythId={feedInput.trim() as Hex} symbol={symbol} slot={system.planets.length} />}
    </div>
  );
}
