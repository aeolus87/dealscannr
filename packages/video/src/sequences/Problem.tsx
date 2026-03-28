import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";
import { FRAMES, SNAP, SLAM } from "../timing";

const sources = [
  { label: "Litigation", x: 4, y: 28 },
  { label: "Eng health", x: 38, y: 24 },
  { label: "Hiring signals", x: 62, y: 30 },
  { label: "News + context", x: 84, y: 26 },
] as const;

export function Problem() {
  const frame = useCurrentFrame();

  const shakeT = frame - 60;
  const shakeX =
    shakeT > 0 && shakeT < 8
      ? Math.sin(shakeT * 8) *
        interpolate(shakeT, [0, 8], [10, 0], { extrapolateRight: "clamp" })
      : 0;
  const shakeY =
    shakeT > 0 && shakeT < 8
      ? Math.cos(shakeT * 6) *
        interpolate(shakeT, [0, 8], [6, 0], { extrapolateRight: "clamp" })
      : 0;

  const introOp = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });

  const tagSpring = spring({ frame: frame - 58, fps: 30, config: SLAM });

  return (
    <SceneShell durationFrames={FRAMES.problem}>
      <div
        style={{
          transform: `translate(${shakeX}px, ${shakeY}px)`,
          height: "100%",
          position: "relative",
        }}
      >
        <p
          style={{
            paddingTop: 24,
            fontSize: 28,
            lineHeight: 1.45,
            color: theme.text,
            fontFamily: theme.fontSans,
            opacity: introOp,
            textAlign: "center",
          }}
        >
          It&apos;s not what you don&apos;t know —{" "}
          <span style={{ color: theme.yellow, fontWeight: 700 }}>
            it&apos;s what you would have seen.
          </span>
        </p>

        {sources.map((src, i) => {
          const s = spring({
            frame: frame - (8 + i * 4),
            fps: 30,
            config: SNAP,
          });
          const drift = Math.sin(frame * 0.05 + i * 1.8) * 6;
          const driftY = Math.cos(frame * 0.04 + i * 2.2) * 5;
          return (
            <div
              key={src.label}
              style={{
                position: "absolute",
                left: `${src.x}%`,
                top: `${src.y}%`,
                transform: `translate(${drift}px, ${driftY + interpolate(s, [0, 1], [30, 0])}px)`,
                opacity: s,
                padding: "14px 22px",
                borderRadius: theme.radiusLg,
                backgroundColor: theme.surface,
                border: `1px solid ${theme.border}`,
                boxShadow: theme.shadowSm,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: theme.text,
                  fontFamily: theme.fontSans,
                  whiteSpace: "nowrap",
                }}
              >
                {src.label}
              </div>
            </div>
          );
        })}

        {/* Tagline */}
        <div
          style={{
            position: "absolute",
            bottom: 100,
            left: 0,
            right: 0,
            textAlign: "center",
            zIndex: 3,
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "22px 40px",
              borderRadius: theme.radiusXl,
              backgroundColor: theme.noticeBg,
              border: `2px solid ${theme.noticeBorder}`,
              boxShadow: "0 0 40px rgba(158,106,3,0.12)",
              fontSize: 38,
              fontWeight: 800,
              lineHeight: 1.25,
              color: theme.text,
              fontFamily: theme.fontDisplay,
              opacity: tagSpring,
              transform: `scale(${interpolate(tagSpring, [0, 1], [1.4, 1])})`,
            }}
          >
            What could embarrass you in the meeting?
          </div>
        </div>
      </div>
    </SceneShell>
  );
}
