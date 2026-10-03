import { ImageResponse } from "next/og";

// Link preview for X, Hacker News, Reddit and iMessage. Next serves it at /opengraph-image and
// adds the og:image / twitter:image tags to every page automatically.
export const alt = "Robots in Space Simulator: what survives on Venus, the Moon, Mars or Mercury, and for how long";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const worlds = [
  { name: "Venus", fact: "464 °C · 92 bar", color: "#e8a04a" },
  { name: "Moon", fact: "−180 °C nights", color: "#c9c9c9" },
  { name: "Mars", fact: "dust storms", color: "#d0643b" },
  { name: "Mercury", fact: "88-day noon", color: "#9a8f86" },
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "radial-gradient(circle at 80% 20%, #3a2414 0%, #120e0b 60%)",
          color: "#f4ece4",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -2 }}>Robots in Space Simulator</div>
          <div style={{ fontSize: 34, color: "#cbb9a8", marginTop: 16 }}>
            Drop a real robot on another world. Watch what fails first.
          </div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {worlds.map((w) => (
            <div
              key={w.name}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                padding: "22px 24px",
                borderRadius: 20,
                border: `2px solid ${w.color}`,
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <div style={{ fontSize: 36, fontWeight: 700, color: w.color }}>{w.name}</div>
              <div style={{ fontSize: 24, color: "#cbb9a8", marginTop: 6 }}>{w.fact}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 24, color: "#8f7f71" }}>
          MuJoCo physics · Unitree G1 · Venera 13 · Starship · runs in your browser
        </div>
      </div>
    ),
    size,
  );
}
