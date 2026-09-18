import type { Metadata } from "next";
import { FocusSetter } from "@/components/FocusSetter";
import { SunSheet } from "@/components/sun/SunSheet";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "The Sun · treasury",
  description: `The treasury at the centre of ${site.name}: every $${site.ticker} trade feeds it, it allots to the planets by mass, and the solar wind turns its ETH into each planet's asset.`,
};

export default function SunPage() {
  return (
    <>
      <FocusSetter focus={{ kind: "sun" }} />
      <div className="frame">
        <SunSheet mode="focus" />
      </div>
    </>
  );
}
