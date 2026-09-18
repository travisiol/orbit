import type { Metadata } from "next";
import Link from "next/link";
import { FocusSetter } from "@/components/FocusSetter";
import { explorer } from "@/lib/chain";
import { PONS_FACTORY, PONS_FEE_ESCROW, PYTH, SUN_CONSTANTS } from "@/lib/contracts";
import { toNumber } from "@/lib/format";
import { CATALOG, ZERO_ADDRESS } from "@/lib/planets";
import { site } from "@/lib/site";
import { DETERMINISTIC_DEPLOYER, SUN, SUN_SALT } from "@/lib/sunDeploy";

export const metadata: Metadata = {
  title: "Docs",
  description: `How ${site.name} works: the Sun, planets anyone can light, satellites and orbits, the solar wind, the vent — and what is not verified.`,
};

const Addr = ({ a }: { a: string }) => (
  <span className="addr">
    <a href={explorer.address(a)} target="_blank" rel="noreferrer">
      {a}
    </a>
  </span>
);

export default function Docs() {
  return (
    <>
      <FocusSetter focus={{ kind: "none" }} />
      <main className="page">
        <div className="page-inner">
          <header style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span className="eyebrow">documentation</span>
            <h1 className="display display-lg">The market is a universe.</h1>
            <p className="prose" style={{ maxWidth: "60ch" }}>
              {site.name} turns the market into a solar system. The <strong>Sun</strong> is a treasury. Every <strong>planet</strong> is an asset issued on Robinhood Chain — and anyone may light one. You do not just hold a token: you choose the planet you orbit, and the Sun pays you in that planet&apos;s asset. Everything below is enforced by one contract with no owner.
            </p>
          </header>

          <section>
            <h2>The mechanic in one breath</h2>
            <ol className="prose">
              <li>
                <strong>$ORBIT</strong> is launched on Pons V2 with the Sun as its creator-fee recipient. Every trade pays the Sun in ETH.
              </li>
              <li>
                Anyone <strong>lights a planet</strong> for an asset: {toNumber(SUN_CONSTANTS.planetFee).toFixed(2)} ETH to the Sun, the token&apos;s address and its Pyth feed. The planet takes the next orbit out.
              </li>
              <li>
                Holders park $ORBIT around a planet — as a <strong>satellite</strong> (×1 gravity, leave after a day) or as one of its twelve <strong>orbits</strong> (×2 gravity, locked one revolution).
              </li>
              <li>
                The Sun <strong>allots</strong> its ETH to the planets in proportion to their <strong>mass</strong> (gravity-weighted $ORBIT). A planet with a third of the mass gets a third of the flow.
              </li>
              <li>
                The <strong>solar wind</strong> turns each planet&apos;s ETH into its asset: anyone may deliver NVDA (say) and take the pending ETH at the Pyth price plus a discount that ramps from 0 to 5% over six hours, resetting after each fill.
              </li>
              <li>
                The delivered asset is owed to the planet&apos;s bodies pro rata to gravity. <strong>Harvest</strong> whenever you like.
              </li>
            </ol>
            <p className="prose">
              Because the flow follows mass and the payout follows mass, <strong>every planet yields the same per unit of gravity</strong> (in ETH terms, before the wind&apos;s discount). Piling into a planet does not raise its yield; it raises its share of the flow and dilutes it by the same amount. The only thing you choose is <em>what you are paid in</em>. That is the point.
            </p>
          </section>

          <section>
            <h2>Lighting a planet</h2>
            <p className="prose">
              <code>deployPlanet(asset, priceId)</code>, from any wallet, with <strong>{toNumber(SUN_CONSTANTS.planetFee).toFixed(2)} ETH</strong>. The fee joins the Sun&apos;s corona and is allotted to the planets already shining. The contract checks what a contract can check: the asset is a contract with <strong>18 decimals</strong> (the wind&apos;s arithmetic assumes it), no planet pays in it yet, it is not $ORBIT, the feed id is not zero. It reads the token&apos;s <code>symbol()</code> and <code>name()</code> itself — nobody types a name. The k-th planet lit takes the k-th orbit and locks its orbits for <strong>(k + 1) × 7 days</strong>, at most 91: the farther out, the slower. The sky holds at most <strong>{SUN_CONSTANTS.maxPlanets}</strong> planets, because every interaction walks them all. A planet is permanent.
            </p>
            <p className="prose">
              <strong>What the contract cannot check</strong> is whether the asset is what its name says, and whether the feed prices it. A copy of a Robinhood token with the same name is a valid ERC-20; the Sun would light it. So the site keeps a <strong>catalog</strong> of assets it has verified on chain (below) and marks planets outside it <span className="warn">unverified</span>, with the raw address to inspect. A mismatched feed hurts only that planet: the wind would pay its fillers the wrong price from that planet&apos;s own ETH — the ETH its bodies were owed. Orbit a planet you understand.
            </p>
          </section>

          <section>
            <h2>The catalog</h2>
            <p className="prose">
              Robinhood&apos;s own stock tokens found on Robinhood Chain and read on 2026-09-18 (<code>name()</code> ends in &ldquo;• Robinhood Token&rdquo;, 18 decimals), with the Pyth feed the site proposes for each: the 24/7 <code>Equity.Index</code> feed where one exists, else the market-hours <code>Equity.US</code> feed (the wind then only blows while the stock trades). The brief&apos;s six come first; they appear in the sky as unlit candidates until someone lights them. <strong>HOOD has no token</strong>: Robinhood has not tokenized its own stock on its own chain (the two &ldquo;HOOD&rdquo; contracts there are memecoins). It stays dark until an issuance exists — then anyone lights it like any other.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>asset</th>
                    <th>issuer</th>
                    <th>token on robinhood chain</th>
                    <th>pyth feed</th>
                  </tr>
                </thead>
                <tbody>
                  {CATALOG.map((c) => (
                    <tr key={c.slug}>
                      <td>
                        <Link href={`/${c.slug}`}>
                          {c.symbol} · {c.name}
                        </Link>
                        {c.brief ? " ★" : ""}
                      </td>
                      <td>{c.issuer}</td>
                      <td>{c.asset === ZERO_ADDRESS ? "no native issuance" : <Addr a={c.asset} />}</td>
                      <td style={{ wordBreak: "break-all" }}>
                        {c.pythId.slice(0, 10)}… <small style={{ color: "var(--ink-3)" }}>({c.feed})</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: 10 }}>★ named by the brief. Any other 18-decimal token with a Pyth feed can be lit from the deploy page; it just will not carry the verified mark.</p>
          </section>

          <section>
            <h2>Bodies</h2>
            <h3>Satellite</h3>
            <p className="prose">
              Any amount ≥ 1,000 ORBIT. Gravity ×1. You can leave a day after your last deposit (each deposit restarts the day). What stays must be ≥ 1,000 or nothing.
            </p>
            <h3>Orbit</h3>
            <p className="prose">
              Total ≥ 500,000 ORBIT (0.05% of the launch supply). Gravity ×2. You take the lowest free of the planet&apos;s <strong>twelve rings</strong>; a full planet accepts no thirteenth orbit, only satellites. Locked for one orbital period from your deposit — every further deposit renews the lock for the whole position. A partial leave must keep ≥ 500,000; leaving entirely releases the ring to the next claimant. A satellite that deposits again as an orbit becomes one; an orbit cannot take satellite deposits.
            </p>
            <h3>Harvest</h3>
            <p className="prose">
              Your share of every delivery since your last touch, in the planet&apos;s asset — plus ETH, if a wind was vented. Entering, leaving and harvesting all settle first, so nothing is ever lost between actions.
            </p>
          </section>

          <section>
            <h2>The Sun</h2>
            <p className="prose">
              The Sun receives ETH from anywhere, but is built for two sources: the creator fees of $ORBIT, and planet fees. Pons sweeps the former to its fee escrow; <code>collect()</code> claims them (anyone may call it, it happens on its own at every interaction). <code>ignite()</code> then allots the Sun&apos;s unallotted ETH — the <strong>corona</strong> — to the planets by mass. A planet nobody orbits gets nothing; a planet everybody left hands its pending ETH back to the corona. Remainders of integer division stay in the corona for the next round.
            </p>
            <p className="prose">
              The Sun holds no $ORBIT of its own, takes no cut, has no operator. There is no function that moves ETH or assets anywhere other than to fillers (against their delivery) and to bodies (what they are owed).
            </p>
          </section>

          <section>
            <h2>The solar wind</h2>
            <p className="prose">
              There is no DEX in the loop. A planet&apos;s pending ETH is a standing offer: deliver the planet&apos;s asset, take ETH at <strong>Pyth&apos;s price × (1 + discount)</strong>. The discount starts at 0 when the wind starts blowing and reaches <strong>{SUN_CONSTANTS.windMaxBps / 100}%</strong> after <strong>{SUN_CONSTANTS.windRampSeconds / 3600} hours</strong>; every fill resets it. Fills are capped at the pending ETH (the delivery is scaled down, you never over-deliver), and you set a minimum ETH out. Prices must be at most {SUN_CONSTANTS.priceMaxAgeSeconds} seconds old — pass a Pyth update with the fill (the update fee is 0 wei on Robinhood Chain today) or rely on one already on chain.
            </p>
            <p className="prose">
              Why a discount and not a fixed price: the filler bears the gas, the inventory and the price risk between fetching a Pyth update and inclusion. A Dutch ramp lets the market find the smallest discount at which someone will do it, and caps the Sun&apos;s cost at 5%.
            </p>
            <h3>The vent</h3>
            <p className="prose">
              If nobody fills for <strong>{SUN_CONSTANTS.windStallSeconds / 86_400} days</strong>, anyone may <code>vent()</code> the planet: its pending ETH is owed to its bodies <em>as ETH</em>, pro rata to gravity, harvested the same way. The oracle is not a single point of failure for the money; the worst case is being paid in ETH instead of the asset.
            </p>
          </section>

          <section>
            <h2>Deployment</h2>
            <p className="prose">
              The Sun is created with CREATE2 through Arachnid&apos;s deterministic-deployment proxy (present on Robinhood Chain), from the exact bytecode this site embeds plus three constructor arguments — the Pons factory, Pyth, the ETH/USD feed. Its address is therefore known before it exists and identical whoever sends the transaction: <Addr a={SUN} />. Anyone can put it on chain from <Link href="/deploy">/deploy</Link>, anyone can then <code>launch()</code> $ORBIT — once — paying Pons&apos; launch fee and an optional first buy (only the logo and website are free parameters), and anyone lights planets, before or after the launch.
            </p>
            <dl className="stat-list" style={{ marginTop: 12 }}>
              <dt>deployer proxy</dt>
              <dd style={{ textAlign: "left" }}>
                <Addr a={DETERMINISTIC_DEPLOYER} />
              </dd>
              <dt>salt</dt>
              <dd style={{ textAlign: "left", wordBreak: "break-all" }}>
                {SUN_SALT} <small>keccak256(&ldquo;orbit:sun:v1&rdquo;)</small>
              </dd>
              <dt>pons factory</dt>
              <dd style={{ textAlign: "left" }}>
                <Addr a={PONS_FACTORY} />
              </dd>
              <dt>pons escrow</dt>
              <dd style={{ textAlign: "left" }}>
                <Addr a={PONS_FEE_ESCROW} />
              </dd>
              <dt>pyth</dt>
              <dd style={{ textAlign: "left" }}>
                <Addr a={PYTH} />
              </dd>
            </dl>
          </section>

          <section>
            <h2>What is verified, what is not</h2>
            <ul className="prose">
              <li>
                <strong>Verified:</strong> the catalog&apos;s stock tokens exist and answer <code>symbol()</code>/<code>name()</code> with 18 decimals; Pyth is deployed at the address above with the feeds listed; the Pons V2 factory, forwarder and escrow addresses and signatures were traced on a fork; the Sun&apos;s own logic is covered by unit tests and by checks against the real chain on a fork, including a real NVDA holder delivering real NVDA to a lit planet and a body harvesting it.
              </li>
              <li>
                <strong>Assumed:</strong> that Pons credits the creator tax to the fee recipient through the same escrow as the base creator fee (a fork shows the tax deducted and held on the curve until Pons sweeps), and that it keeps sweeping after graduation. Both are Pons&apos; behaviour; if they differ, the Sun simply receives less.
              </li>
              <li>
                <strong>Not knowable here:</strong> who really issued a token behind a planet the site did not check, and how any of this reads to a regulator. Tokenized stocks are claims on their issuer, not shares; nothing on this site is advice.
              </li>
            </ul>
          </section>

          <section className="faq">
            <h2>Questions</h2>
            <details>
              <summary>Who decides which planets exist?</summary>
              <p className="prose">Whoever pays the fee. The brief&apos;s six are drawn as unlit candidates so the sky is never empty of them, but the first planet lit could be SPY, and the sky keeps growing to forty-eight. The site&apos;s catalog only says which assets it checked; the contract does not read it.</p>
            </details>
            <details>
              <summary>Why is HOOD dark?</summary>
              <p className="prose">Because the asset does not exist. Robinhood has not issued a HOOD stock token on Robinhood Chain, and a planet cannot pay in a token that is not there. It is drawn because the brief names it, and because a dark planet is more honest than a substitute. The day a token exists, anyone lights it.</p>
            </details>
            <details>
              <summary>Can someone light a fake planet?</summary>
              <p className="prose">Yes — any 18-decimal token with any feed. The Sun cannot know an issuer. What a fake planet can do is limited to itself: it earns its share of the flow by the $ORBIT parked around it, and its wind pays fillers from that share; it cannot touch other planets&apos; ETH. The site marks it unverified and shows the address. Do not orbit what you have not checked.</p>
            </details>
            <details>
              <summary>Which planet has the best yield?</summary>
              <p className="prose">None. Flow follows mass and payout follows mass, so each unit of gravity earns the same ETH-equivalent on every planet. The one variable is the wind&apos;s discount at fill time, which is bounded at 5% and tends to be lower where more fillers compete. Choose the asset you want to hold.</p>
            </details>
            <details>
              <summary>Why would anyone fill the wind?</summary>
              <p className="prose">To buy ETH below market with an asset they hold or can source. At 0% discount only a filler with a reason (a holder rebalancing) will bother; as the ramp climbs, arbitrage turns positive after gas and Pyth latency. Twelve times a day is the design tempo, not a promise.</p>
            </details>
            <details>
              <summary>Can a whale front-run an allotment?</summary>
              <p className="prose">They can enter a planet before an ignite and be counted in its mass. But assets are owed at <em>fill</em> time, satellites cannot leave for a day, and orbits are locked a revolution — so the whale must stay while the wind blows, which is just being a holder.</p>
            </details>
            <details>
              <summary>What happens after $ORBIT graduates from the Pons curve?</summary>
              <p className="prose">Trading moves to the DEX Pons graduates to. Whether creator fees keep flowing from there is Pons&apos; design, not ours, and not verified. The Sun keeps working on whatever ETH it receives, from any source — planet fees included.</p>
            </details>
            <details>
              <summary>Who can change the rules?</summary>
              <p className="prose">Nobody. No owner, no admin key, no proxy, no pause. The constants in this page are the contract&apos;s constants. A different rule is a different Sun at a different address.</p>
            </details>
          </section>
        </div>
      </main>
    </>
  );
}
