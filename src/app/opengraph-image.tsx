import { ImageResponse } from "next/og";
import { BRIEF, ZERO_ADDRESS } from "@/lib/planets";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const alt = `${site.name} — ${site.hook}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The system, drawn flat: sun, six orbits, six bodies, the line. */
export default function OpenGraphImage() {
  const cx = 780;
  const cy = 330;
  const angles = [0.4, 2.1, 3.9, 0.9, 5.2, 2.9];
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, background: "#000", display: "flex", position: "relative", fontFamily: "Inter, Helvetica, Arial, sans-serif", color: "#f4f4f2" }}>
        {BRIEF.map((c, i) => {
          const r = 3.4 + 1.55 * i;
          const rx = r * 34;
          const ry = r * 13;
          return <div key={c.slug} style={{ position: "absolute", left: cx - rx, top: cy - ry, width: rx * 2, height: ry * 2, borderRadius: "50%", border: `1px solid rgba(255,255,255,${c.asset === ZERO_ADDRESS ? 0.08 : 0.16})`, display: "flex" }} />;
        })}
        <div style={{ position: "absolute", left: cx - 90, top: cy - 90, width: 180, height: 180, borderRadius: 999, background: "radial-gradient(circle, rgba(255,243,214,0.9) 0%, rgba(255,233,194,0.35) 22%, rgba(255,233,194,0) 70%)", display: "flex" }} />
        <div style={{ position: "absolute", left: cx - 22, top: cy - 22, width: 44, height: 44, borderRadius: 999, background: "#fff6e2", display: "flex" }} />
        {BRIEF.map((c, i) => {
          const orbit = 3.4 + 1.55 * i;
          const rx = orbit * 34;
          const ry = orbit * 13;
          const x = cx + Math.cos(angles[i]) * rx;
          const y = cy + Math.sin(angles[i]) * ry;
          const dark = c.asset === ZERO_ADDRESS;
          const r = dark ? 6 : 9 + (c.symbol === "NVDA" ? 5 : c.symbol === "GLD" ? 4 : 0);
          const fill = dark ? "#1a1c20" : c.surface === "gold" ? "#caa24a" : c.surface === "circuit" ? "#2a2f33" : "#d7dbe2";
          return (
            <div key={c.slug} style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: 999, background: fill, border: c.surface === "circuit" ? "1px solid rgba(220,255,235,0.6)" : "none", display: "flex" }}>
              <div style={{ position: "absolute", left: r * 2 + 10, top: -4, fontSize: 16, letterSpacing: 2, color: dark ? "rgba(244,244,242,0.35)" : "#f4f4f2", display: "flex" }}>{c.symbol}</div>
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 64, top: 64, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 16, letterSpacing: 6, color: "rgba(244,244,242,0.5)", display: "flex" }}>{site.name} · ROBINHOOD CHAIN</div>
          <div style={{ fontSize: 74, fontWeight: 300, letterSpacing: -2, lineHeight: 0.98, textTransform: "uppercase", maxWidth: 560, display: "flex" }}>{site.hook}</div>
          <div style={{ fontSize: 22, color: "rgba(244,244,242,0.65)", maxWidth: 520, lineHeight: 1.35, display: "flex" }}>Own the financial system. The Sun is the treasury, every planet is an asset, anyone may light one. Choose the one you orbit; be paid in it.</div>
        </div>
      </div>
    ),
    size,
  );
}
