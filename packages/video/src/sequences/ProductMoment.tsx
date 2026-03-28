import React from "react";
import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";

export function ProductMoment() {
  const frame = useCurrentFrame();
  const card = spring({
    frame,
    fps: 30,
    config: { damping: 17, mass: 0.65, stiffness: 105 },
  });

  return (
    <SceneShell accent>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          height: "100%",
          gap: 32,
        }}
      >
        <h2
          style={{
            fontSize: 40,
            fontWeight: 600,
            color: theme.muted,
            fontFamily: theme.fontSans,
            letterSpacing: "-0.02em",
            opacity: interpolate(frame, [0, 25], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          DealScannr
        </h2>
        <p
          style={{
            fontSize: 36,
            lineHeight: 1.35,
            color: theme.text,
            fontFamily: theme.fontSans,
            maxWidth: 900,
            opacity: spring({
              frame: frame - 6,
              fps: 30,
              config: { damping: 20, mass: 0.75, stiffness: 95 },
            }),
          }}
        >
          One company name in — a structured intelligence report out. About a minute,
          not two weeks of manual tabs.
        </p>
        <div
          style={{
            marginTop: 8,
            borderRadius: 18,
            border: `1px solid ${theme.stroke}`,
            backgroundColor: theme.bgElevated,
            padding: 36,
            opacity: card,
            transform: `translateY(${interpolate(card, [0, 1], [40, 0])}px)`,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
              fontFamily: theme.fontSans,
            }}
          >
            <div>
              <div style={{ fontSize: 22, color: theme.muted, marginBottom: 8 }}>Input</div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: theme.text,
                  padding: "14px 18px",
                  borderRadius: 10,
                  backgroundColor: "rgba(255,255,255,0.04)",
                  border: `1px solid ${theme.stroke}`,
                }}
              >
                Company name
              </div>
            </div>
            <div>
              <div style={{ fontSize: 22, color: theme.muted, marginBottom: 8 }}>Output</div>
              <div style={{ fontSize: 24, color: theme.accent, fontWeight: 600 }}>
                Verdict · Risk · Brief · Probes (cited)
              </div>
            </div>
          </div>
        </div>
      </div>
    </SceneShell>
  );
}
