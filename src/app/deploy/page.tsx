import type { Metadata } from "next";
import { DeploySun } from "@/components/deploy/DeploySun";
import { LightPlanet } from "@/components/deploy/LightPlanet";
import { FocusSetter } from "@/components/FocusSetter";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Deploy",
  description: `Put the Sun on Robinhood Chain at its predicted address, launch $${site.ticker} through it, and light planets — from any wallet.`,
};

export default function DeployPage() {
  return (
    <>
      <FocusSetter focus={{ kind: "sun" }} />
      <main className="page">
        <div className="page-inner" style={{ maxWidth: 720 }}>
          <header style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span className="eyebrow">deploy</span>
            <h1 className="display display-lg">Light the Sun. Then the planets.</h1>
            <p className="prose" style={{ maxWidth: "58ch" }}>
              Nobody holds a key for {site.name}. The Sun&apos;s address is computed from its bytecode and its arguments, so the first wallet that sends the transaction puts it on chain for everyone; the first wallet that calls <code>launch()</code> puts ${site.ticker} on Pons with the Sun as its fee recipient. And every planet is lit by whoever pays its fee — the brief&apos;s six, or any other asset on the chain.
            </p>
          </header>
          <DeploySun />
          <LightPlanet />
          <section>
            <h2>What fixes the Sun&apos;s address</h2>
            <p className="prose">
              Every byte of the compiled contract (a recompile after any source change, including the metadata hash), the Pons factory, the Pyth address and the ETH/USD feed. Planets are not part of it: they are storage, added one by one, by anyone, after the fact. Change any of the four and the address changes — never a silent swap of what lives at a known address.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
