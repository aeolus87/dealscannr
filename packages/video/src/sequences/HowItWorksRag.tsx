import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";
import { FRAMES, SNAP } from "../timing";

const stages = [
  { label: "Data sources", detail: "SEC · Court · GitHub · Jobs · News", at: 8 },
  { label: "Evidence chunks", detail: "Entity-resolved, embedded", at: 14 },
  { label: "Retrieve + rerank", detail: "Semantic → cross-encoder", at: 20 },
  { label: "Grounded synthesis", detail: "Claims must cite evidence", at: 26 },
  { label: "Structured report", detail: "Verdict · Risk · Brief · Probes", at: 32 },
] as const;

const NODE_W = 250;
const GAP = 60;
const PIPELINE_W = 5 * NODE_W + 4 * GAP;

const NODE_X = stages.map((_, i) => i * (NODE_W + GAP));

export function HowItWorksRag() {
  const frame = useCurrentFrame();

  const titleS = spring({ frame, fps: 30, config: SNAP });

  const pulseStartX = NODE_X[0] + NODE_W / 2;
  const pulseEndX = NODE_X[4] + NODE_W / 2;
  const pulseX = interpolate(frame, [45, 130], [pulseStartX, pulseEndX], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulseOp = interpolate(frame, [45, 50, 125, 130], [0, 0.9, 0.9, 0], {
    extrapolateRight: "clamp",
  });

  const tagsOp = spring({ frame: frame - 100, fps: 30, config: SNAP });

  return (
    <SceneShell durationFrames={FRAMES.rag}>
      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 30,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 36,
          fontWeight: 700,
          color: theme.text,
          fontFamily: theme.fontDisplay,
          opacity: titleS,
          transform: `translateY(${interpolate(titleS, [0, 1], [12, 0])}px)`,
        }}
      >
        How the scan works
      </div>

      {/* Horizontal pipeline */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: PIPELINE_W,
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* Nodes */}
        {stages.map((stage, i) => {
          const s = spring({ frame: frame - stage.at, fps: 30, config: SNAP });
          const active = frame > stage.at + 12;
          return (
            <div
              key={stage.label}
              style={{
                position: "absolute",
                left: NODE_X[i],
                top: 0,
                width: NODE_W,
                padding: "18px 16px",
                borderRadius: theme.radiusLg,
                backgroundColor: theme.surface,
                border: `1px solid ${active ? theme.accent : theme.border}`,
                boxShadow: active
                  ? `0 0 20px ${theme.accentSoft}, ${theme.shadowSm}`
                  : theme.shadowSm,
                opacity: s,
                transform: `translateY(${interpolate(s, [0, 1], [14, 0])}px)`,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: active ? theme.accent : theme.text,
                  fontFamily: theme.fontSans,
                  marginBottom: 4,
                }}
              >
                {stage.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: theme.muted,
                  fontFamily: theme.fontSans,
                  lineHeight: 1.4,
                }}
              >
                {stage.detail}
              </div>
            </div>
          );
        })}

        {/* Horizontal connectors */}
        {NODE_X.slice(0, -1).map((x, i) => {
          const drawAt = stages[i].at + 8;
          const draw = interpolate(frame, [drawAt, drawAt + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const connY = 38;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x + NODE_W,
                top: connY,
                height: 2,
                width: GAP * draw,
                backgroundColor: theme.accent,
                opacity: 0.45,
              }}
            />
          );
        })}

        {/* Pulse dot */}
        <div
          style={{
            position: "absolute",
            left: pulseX,
            top: 38,
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: theme.accent,
            boxShadow: `0 0 14px ${theme.accent}`,
            transform: "translate(-50%, -50%)",
            opacity: pulseOp,
          }}
        />
      </div>

      {/* Tags */}
      <div
        style={{
          position: "absolute",
          bottom: 30,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 10,
          opacity: tagsOp,
        }}
      >
        {["Entity resolution", "Retrieve", "Synthesis", "Citations"].map(
          (t) => (
            <span
              key={t}
              style={{
                fontSize: 14,
                padding: "6px 14px",
                borderRadius: 999,
                border: `1px solid ${theme.border}`,
                color: theme.text,
                fontFamily: theme.fontMono,
                backgroundColor: theme.surface,
              }}
            >
              {t}
            </span>
          ),
        )}
      </div>
    </SceneShell>
  );
}
