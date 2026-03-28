import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";
import { FRAMES, SNAP } from "../timing";

const particles = Array.from({ length: 24 }, (_, i) => ({
  x: (i * 137.5) % 100,
  startY: 108 + (i * 29) % 35,
  speed: 0.3 + (i % 5) * 0.12,
  size: 2 + (i % 3),
  opacity: 0.06 + (i % 3) * 0.03,
}));

export function Cta() {
  const frame = useCurrentFrame();

  const domain = spring({ frame, fps: 30, config: SNAP });
  const breathe = Math.sin(frame * 0.08) * 0.3 + 0.7;
  const sub = spring({ frame: frame - 8, fps: 30, config: SNAP });
  const tag = interpolate(frame, [22, 38], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <SceneShell durationFrames={FRAMES.cta}>
      {particles.map((p, i) => {
        const y = p.startY - frame * p.speed;
        if (y < -5 || y > 110) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${y}%`,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              backgroundColor: theme.accent,
              opacity: p.opacity,
            }}
          />
        );
      })}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
          textAlign: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: theme.text,
            fontFamily: theme.fontDisplay,
            opacity: domain,
            transform: `scale(${interpolate(domain, [0, 1], [0.9, 1])})`,
            textShadow: `0 0 ${55 * breathe}px ${theme.accentSoft}, 0 0 ${100 * breathe}px rgba(61,212,192,0.05)`,
          }}
        >
          dealscannr.com
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 26,
            color: theme.accent,
            fontWeight: 600,
            fontFamily: theme.fontSans,
            opacity: sub,
          }}
        >
          Try a scan &middot; Pro from $99/mo
        </div>

        <p
          style={{
            marginTop: 28,
            fontSize: 22,
            lineHeight: 1.5,
            color: theme.muted,
            fontFamily: theme.fontSans,
            opacity: tag,
          }}
        >
          The scan you should&apos;ve run before you said yes to the meeting.
        </p>
      </div>
    </SceneShell>
  );
}
