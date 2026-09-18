import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** A ring and its body: the mark, black on black with a white orbit. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 64, height: 64, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <div style={{ width: 40, height: 40, borderRadius: 999, border: "2px solid rgba(255,255,255,0.9)", display: "flex" }} />
        <div style={{ position: "absolute", left: 30, top: 30, width: 8, height: 8, borderRadius: 999, background: "#fff3d6", display: "flex" }} />
        <div style={{ position: "absolute", left: 46, top: 16, width: 7, height: 7, borderRadius: 999, background: "#c9a55a", display: "flex" }} />
      </div>
    ),
    size,
  );
}
