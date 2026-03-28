import React from "react";
import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";

export function Hook() {
  const frame = useCurrentFrame();
  const title1 = spring({
    frame,
    fps: 30,
    config: { damping: 16, mass: 0.6, stiffness: 100 },
  });
  const title2 = spring({
    frame: frame - 8,
    fps: 30,
    config: { damping: 16, mass: 0.6, stiffness: 100 },
  });
  const sub = spring({
    frame: frame - 18,
    fps: 30,
    config: { damping: 18, mass: 0.7, stiffness: 90 },
  });
  const rows = interpolate(frame, [20, 55], [0, 1], { extrapolateRight: "clamp" });

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
        <div
          style={{
            fontSize: 22,
            color: theme.muted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            opacity: interpolate(sub, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(sub, [0, 1], [12, 0])}px)`,
            fontFamily: theme.fontSans,
          }}
        >
          Pre-call intelligence
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.05,
            color: theme.text,
            fontFamily: theme.fontSans,
            opacity: title1,
            transform: `translateY(${interpolate(title1, [0, 1], [28, 0])}px)`,
          }}
        >
          After Crunchbase
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.05,
            color: theme.accent,
            fontFamily: theme.fontSans,
            opacity: title2,
            transform: `translateY(${interpolate(title2, [0, 1], [28, 0])}px)`,
          }}
        >
          before the first call
        </div>
        <div
          style={{
            marginTop: 24,
            height: 4,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${theme.accent}, transparent)`,
            opacity: interpolate(rows, [0, 1], [0, 0.9]),
            transform: `scaleX(${interpolate(rows, [0, 1], [0.2, 1])})`,
            transformOrigin: "left center",
          }}
        />
        <p
          style={{
            fontSize: 30,
            lineHeight: 1.45,
            color: theme.muted,
            maxWidth: 880,
            fontFamily: theme.fontSans,
            opacity: interpolate(frame, [40, 75], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Funding, founders, logos — you&apos;re walking into the call.
        </p>
      </div>
    </SceneShell>
  );
}
