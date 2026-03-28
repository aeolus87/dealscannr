import React from "react";
import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";

const bullets = [
  "Not another database UI — answers with structure",
  "Cross-source reasoning + verdict-oriented report",
  "Time-to-answer for high-deal-volume angels & micro-VCs",
  "Accessible pricing vs $30K/yr enterprise data rooms",
] as const;

export function InvestorWhy() {
  const frame = useCurrentFrame();

  return (
    <SceneShell accent>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          height: "100%",
          gap: 28,
        }}
      >
        <h2
          style={{
            fontSize: 40,
            fontWeight: 700,
            color: theme.text,
            fontFamily: theme.fontSans,
            opacity: interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Why investors care
        </h2>
        <p
          style={{
            fontSize: 30,
            lineHeight: 1.45,
            color: theme.muted,
            fontFamily: theme.fontSans,
            maxWidth: 920,
            opacity: spring({
              frame: frame - 8,
              fps: 30,
              config: { damping: 20, mass: 0.75, stiffness: 95 },
            }),
          }}
        >
          Generic AI search optimizes for fluent answers. The next layer isn&apos;t more
          rows — it&apos;s{" "}
          <span style={{ color: theme.text, fontWeight: 600 }}>answer-quality with provenance</span>{" "}
          for one resolved company, fast.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {bullets.map((line, i) => {
            const delay = 28 + i * 38;
            const s = spring({
              frame: frame - delay,
              fps: 30,
              config: { damping: 17, mass: 0.65, stiffness: 108 },
            });
            return (
              <div
                key={line}
                style={{
                  fontSize: 28,
                  lineHeight: 1.4,
                  color: theme.text,
                  fontFamily: theme.fontSans,
                  paddingLeft: 20,
                  borderLeft: `4px solid ${theme.accent}`,
                  opacity: s,
                  transform: `translateX(${interpolate(s, [0, 1], [-16, 0])}px)`,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
}
