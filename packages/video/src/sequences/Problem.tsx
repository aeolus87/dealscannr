import React from "react";
import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";

const bullets = [
  "Litigation & regulatory",
  "Engineering health",
  "Hiring signals",
  "News + baseline context",
] as const;

export function Problem() {
  const frame = useCurrentFrame();

  return (
    <SceneShell>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          height: "100%",
          gap: 36,
        }}
      >
        <p
          style={{
            fontSize: 32,
            lineHeight: 1.4,
            color: theme.text,
            fontFamily: theme.fontSans,
            opacity: spring({
              frame,
              fps: 30,
              config: { damping: 20, mass: 0.8, stiffness: 100 },
            }),
          }}
        >
          The awkward part isn&apos;t what you don&apos;t know — it&apos;s what you{" "}
          <span style={{ color: theme.warn }}>would have seen</span> if you had time
          to read filings, repos, job posts, and the messy web… then connect the dots.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {bullets.map((label, i) => {
            const delay = 18 + i * 14;
            const s = spring({
              frame: frame - delay,
              fps: 30,
              config: { damping: 17, mass: 0.65, stiffness: 110 },
            });
            return (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  opacity: s,
                  transform: `translateX(${interpolate(s, [0, 1], [-24, 0])}px)`,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: theme.accent,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 34,
                    fontWeight: 600,
                    color: theme.text,
                    fontFamily: theme.fontSans,
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 12,
            padding: "22px 26px",
            borderRadius: 14,
            border: `1px solid ${theme.stroke}`,
            backgroundColor: theme.bgElevated,
            fontSize: 36,
            fontWeight: 700,
            color: theme.text,
            fontFamily: theme.fontSans,
            opacity: spring({
              frame: frame - 95,
              fps: 30,
              config: { damping: 18, mass: 0.7, stiffness: 95 },
            }),
          }}
        >
          What could embarrass you in the meeting?
        </div>
      </div>
    </SceneShell>
  );
}
