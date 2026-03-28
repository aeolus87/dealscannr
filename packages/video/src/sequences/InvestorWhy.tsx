import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";
import { FRAMES, SNAP, SLAM } from "../timing";

export function InvestorWhy() {
  const frame = useCurrentFrame();

  const titleOp = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const priceOld = interpolate(frame, [6, 18], [0, 1], {
    extrapolateRight: "clamp",
  });
  const priceStrike = interpolate(frame, [24, 38], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const priceNew = spring({ frame: frame - 40, fps: 30, config: SLAM });

  const timeOld = interpolate(frame, [12, 24], [0, 1], {
    extrapolateRight: "clamp",
  });
  const timeStrike = interpolate(frame, [30, 44], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const timeNew = spring({ frame: frame - 46, fps: 30, config: SLAM });

  const bullets = [
    "Cross-source signal synthesis",
    "Verdict reports with provenance",
    "50K+ angels underserved by PitchBook",
  ] as const;

  return (
    <SceneShell accent durationFrames={FRAMES.investor}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          height: "100%",
          gap: 14,
        }}
      >
        <h2
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: theme.text,
            fontFamily: theme.fontDisplay,
            opacity: titleOp,
            margin: 0,
            textAlign: "center",
          }}
        >
          The investor angle
        </h2>

        {/* Side-by-side comparisons */}
        <div style={{ display: "flex", gap: 48, marginTop: 4 }}>
          {/* Price column */}
          <div style={{ flex: 1, textAlign: "center" }}>
            <div
              style={{
                position: "relative",
                display: "inline-block",
                opacity: priceOld,
              }}
            >
              <span
                style={{
                  fontSize: 42,
                  fontWeight: 700,
                  color: theme.muted,
                  fontFamily: theme.fontSans,
                }}
              >
                $30,000 / yr
              </span>
              <div
                style={{
                  position: "absolute",
                  top: "52%",
                  left: 0,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.red,
                  width: `${priceStrike}%`,
                }}
              />
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 56,
                fontWeight: 800,
                color: theme.green,
                fontFamily: theme.fontDisplay,
                letterSpacing: "-0.02em",
                opacity: priceNew,
                transform: `scale(${interpolate(priceNew, [0, 1], [1.3, 1])})`,
                textShadow: `0 0 30px ${theme.positiveSoft}`,
              }}
            >
              $99 / mo
            </div>
          </div>

          {/* Time column */}
          <div style={{ flex: 1, textAlign: "center" }}>
            <div
              style={{
                position: "relative",
                display: "inline-block",
                opacity: timeOld,
              }}
            >
              <span
                style={{
                  fontSize: 42,
                  fontWeight: 700,
                  color: theme.muted,
                  fontFamily: theme.fontSans,
                }}
              >
                2 weeks
              </span>
              <div
                style={{
                  position: "absolute",
                  top: "52%",
                  left: 0,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.red,
                  width: `${timeStrike}%`,
                }}
              />
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 56,
                fontWeight: 800,
                color: theme.accent,
                fontFamily: theme.fontDisplay,
                letterSpacing: "-0.02em",
                opacity: timeNew,
                transform: `scale(${interpolate(timeNew, [0, 1], [1.3, 1])})`,
                textShadow: `0 0 30px ${theme.accentSoft}`,
              }}
            >
              ~60 seconds
            </div>
          </div>
        </div>

        {/* Differentiator bullets — horizontal row */}
        <div
          style={{
            display: "flex",
            gap: 20,
            marginTop: 16,
            justifyContent: "center",
          }}
        >
          {bullets.map((line, i) => {
            const s = spring({
              frame: frame - (65 + i * 5),
              fps: 30,
              config: SNAP,
            });
            return (
              <div
                key={line}
                style={{
                  fontSize: 20,
                  color: theme.text,
                  fontFamily: theme.fontSans,
                  paddingLeft: 14,
                  borderLeft: `3px solid ${theme.accent}`,
                  opacity: s,
                  transform: `translateY(${interpolate(s, [0, 1], [10, 0])}px)`,
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
