import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";

type Props = {
  children: ReactNode;
  accent?: boolean;
  durationFrames?: number;
};

export function SceneShell({
  children,
  accent,
  durationFrames = 300,
}: Props) {
  const frame = useCurrentFrame();

  const driftX = interpolate(frame, [0, durationFrames], [-4, 4], {
    extrapolateRight: "clamp",
  });
  const driftY = interpolate(frame, [0, durationFrames], [2, -2], {
    extrapolateRight: "clamp",
  });
  const zoom = interpolate(frame, [0, durationFrames], [1.0, 1.018], {
    extrapolateRight: "clamp",
  });

  const orb1X = interpolate(frame, [0, durationFrames], [65, 80], {
    extrapolateRight: "clamp",
  });
  const orb2X = interpolate(frame, [0, durationFrames], [15, 30], {
    extrapolateRight: "clamp",
  });
  const orb3X = interpolate(frame, [0, durationFrames], [40, 55], {
    extrapolateRight: "clamp",
  });
  const auroraX = interpolate(frame, [0, durationFrames], [-30, 30], {
    extrapolateRight: "clamp",
  });

  const tealStr = accent ? "rgba(61,212,192,0.16)" : "rgba(61,212,192,0.09)";
  const amberStr = accent ? "rgba(210,153,34,0.12)" : "rgba(210,153,34,0.06)";
  const purpleStr = "rgba(100,60,200,0.07)";

  return (
    <AbsoluteFill style={{ backgroundColor: theme.canvas, overflow: "hidden" }}>
      {/* Aurora band — wide horizontal color sweep */}
      <div
        style={{
          position: "absolute",
          left: "-15%",
          right: "-15%",
          top: "15%",
          height: "55%",
          background: `linear-gradient(90deg, transparent, rgba(61,212,192,0.035) 20%, rgba(100,60,200,0.03) 45%, rgba(210,153,34,0.025) 70%, transparent 90%)`,
          filter: "blur(70px)",
          transform: `translateX(${auroraX}px)`,
        }}
      />

      {/* Orb 1 — teal, top-right */}
      <div
        style={{
          position: "absolute",
          left: `${orb1X}%`,
          top: "18%",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${tealStr}, transparent 70%)`,
          filter: "blur(100px)",
          transform: "translate(-50%,-50%)",
        }}
      />
      {/* Orb 2 — amber, bottom-left */}
      <div
        style={{
          position: "absolute",
          left: `${orb2X}%`,
          top: "72%",
          width: 440,
          height: 440,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${amberStr}, transparent 70%)`,
          filter: "blur(90px)",
          transform: "translate(-50%,-50%)",
        }}
      />
      {/* Orb 3 — purple, center-left */}
      <div
        style={{
          position: "absolute",
          left: `${orb3X}%`,
          top: "45%",
          width: 380,
          height: 380,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${purpleStr}, transparent 70%)`,
          filter: "blur(80px)",
          transform: "translate(-50%,-50%)",
        }}
      />

      {/* Dot grid texture */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.018) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          pointerEvents: "none",
        }}
      />

      {/* Vignette — deep from all edges */}
      <AbsoluteFill
        style={{
          background: [
            `radial-gradient(ellipse 85% 75% at 50% 50%, transparent 25%, ${theme.canvas} 100%)`,
            `linear-gradient(180deg, rgba(8,11,16,0.5) 0%, transparent 12%, transparent 88%, rgba(8,11,16,0.5) 100%)`,
          ].join(", "),
        }}
      />

      {/* Content with camera drift */}
      <AbsoluteFill
        style={{
          transform: `translate(${driftX}px, ${driftY}px) scale(${zoom})`,
          padding: "36px 64px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "94%",
            maxWidth: "100%",
            margin: "0 auto",
            height: "100%",
            position: "relative",
          }}
        >
          {children}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
