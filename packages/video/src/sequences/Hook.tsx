import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";
import { FRAMES, SNAP } from "../timing";

export function Hook() {
  const frame = useCurrentFrame();

  const flash = interpolate(frame, [0, 1, 2, 7], [0, 0.9, 0.6, 0], {
    extrapolateRight: "clamp",
  });

  const title = "After Crunchbase";
  const chars = Math.floor(
    interpolate(frame, [3, 17], [0, title.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const cur = frame >= 3 && frame < 30 && Math.floor(frame / 3) % 2 === 0;

  const line2 = spring({ frame: frame - 16, fps: 30, config: SNAP });
  const tag = spring({ frame: frame - 26, fps: 30, config: SNAP });
  const sub = interpolate(frame, [32, 48], [0, 1], {
    extrapolateRight: "clamp",
  });

  const ringScale = interpolate(frame, [8, 70], [0.4, 1.6], {
    extrapolateRight: "clamp",
  });
  const ringOp = interpolate(frame, [8, 30, 70, 100], [0, 0.18, 0.06, 0.03], {
    extrapolateRight: "clamp",
  });

  const scanX = interpolate(frame, [4, 90], [-10, 110], {
    extrapolateRight: "clamp",
  });
  const scanOp = interpolate(frame, [4, 12, 80, 90], [0, 0.08, 0.08, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <SceneShell accent durationFrames={FRAMES.hook}>
      {/* Expanding ring */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "48%",
          width: 600,
          height: 600,
          borderRadius: "50%",
          border: `2px solid ${theme.accent}`,
          transform: `translate(-50%,-50%) scale(${ringScale})`,
          opacity: ringOp,
          boxShadow: `0 0 80px 30px ${theme.accentSoft}`,
        }}
      />

      {/* Horizontal scan line */}
      <div
        style={{
          position: "absolute",
          left: `${scanX}%`,
          top: 0,
          bottom: 0,
          width: 2,
          background: `linear-gradient(180deg, transparent, ${theme.accent}44, transparent)`,
          opacity: scanOp,
        }}
      />

      {/* Content — centered */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
          gap: 10,
          position: "relative",
          zIndex: 1,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.05,
            color: theme.text,
            fontFamily: theme.fontDisplay,
            letterSpacing: "-0.03em",
            textShadow: `0 0 50px ${theme.accentSoft}`,
          }}
        >
          {title.slice(0, chars)}
          {cur && <span style={{ color: theme.accent }}>|</span>}
        </div>

        <div
          style={{
            fontSize: 66,
            fontWeight: 700,
            lineHeight: 1.05,
            color: theme.accent,
            fontFamily: theme.fontDisplay,
            letterSpacing: "-0.02em",
            opacity: line2,
            transform: `translateY(${interpolate(line2, [0, 1], [20, 0])}px)`,
            textShadow: "0 0 50px rgba(61,212,192,0.2)",
          }}
        >
          before the first call
        </div>

        <div style={{ marginTop: 16, opacity: tag }}>
          <span
            style={{
              fontSize: 15,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: theme.muted,
              fontFamily: theme.fontMono,
              padding: "7px 16px",
              border: `1px solid ${theme.border}`,
              borderRadius: 5,
            }}
          >
            Pre-call intelligence
          </span>
        </div>

        <p
          style={{
            fontSize: 24,
            lineHeight: 1.45,
            color: theme.muted,
            fontFamily: theme.fontSans,
            marginTop: 10,
            opacity: sub,
          }}
        >
          You checked funding rounds, founders, logos.
        </p>
      </div>

      <AbsoluteFill
        style={{
          backgroundColor: theme.accent,
          opacity: flash,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
    </SceneShell>
  );
}
