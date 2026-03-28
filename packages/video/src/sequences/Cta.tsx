import React from "react";
import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";

export function Cta() {
  const frame = useCurrentFrame();
  const pulse = spring({
    frame,
    fps: 30,
    config: { damping: 12, mass: 0.5, stiffness: 140 },
  });

  return (
    <SceneShell>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          height: "100%",
          gap: 24,
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: theme.text,
            fontFamily: theme.fontSans,
            opacity: pulse,
            transform: `scale(${interpolate(pulse, [0, 1], [0.94, 1])})`,
          }}
        >
          dealscannr.com
        </div>
        <div
          style={{
            fontSize: 30,
            color: theme.accent,
            fontWeight: 600,
            fontFamily: theme.fontSans,
            opacity: spring({
              frame: frame - 10,
              fps: 30,
              config: { damping: 18, mass: 0.7, stiffness: 100 },
            }),
          }}
        >
          Try a scan · Pro from $99/mo
        </div>
        <p
          style={{
            fontSize: 28,
            lineHeight: 1.45,
            color: theme.muted,
            fontFamily: theme.fontSans,
            maxWidth: 880,
            opacity: spring({
              frame: frame - 28,
              fps: 30,
              config: { damping: 20, mass: 0.75, stiffness: 95 },
            }),
          }}
        >
          Run the scan you should&apos;ve run before you said yes to the meeting.
        </p>
      </div>
    </SceneShell>
  );
}
