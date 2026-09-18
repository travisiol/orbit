import type { Metadata } from "next";
import { PlanetFocus } from "@/components/planet/PlanetFocus";
import { CATALOG, candidateBySlug } from "@/lib/planets";
import { site } from "@/lib/site";

type Params = { params: Promise<{ planet: string }> };

/**
 * Any key is a valid route: a catalog slug, an on-chain symbol, `p<index>`.
 * Planets are lit by anyone at any time, so the list cannot be known at
 * build; the catalog's slugs are prerendered, the rest render on demand and
 * resolve against the live system in the browser.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return CATALOG.map((c) => ({ planet: c.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { planet } = await params;
  const c = candidateBySlug(planet);
  if (!c) {
    const title = `${planet.toUpperCase()} · planet`;
    return { title, description: `A planet of ${site.name}, lit by someone on Robinhood Chain. Orbit it and be paid in its asset.` };
  }
  const title = `${c.name} · ${c.symbol}`;
  const description =
    c.asset === "0x0000000000000000000000000000000000000000"
      ? `${c.name} is a dark candidate of ${site.name}: no native ${c.symbol} token exists on Robinhood Chain yet.`
      : `Enter ${c.name}. Launch a satellite or claim one of twelve orbits around ${c.symbol}, and be paid in ${c.symbol} by the Sun — or light the planet yourself if nobody has.`;
  return { title, description, openGraph: { title: `${title} · ${site.name}`, description }, twitter: { title: `${title} · ${site.name}`, description } };
}

export default async function PlanetPage({ params }: Params) {
  const { planet } = await params;
  return <PlanetFocus routeKey={planet} />;
}
