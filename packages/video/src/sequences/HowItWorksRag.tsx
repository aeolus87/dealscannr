import React from "react";
import { interpolate, spring, useCurrentFrame } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { theme } from "../theme";

const steps: { title: string; body: string }[] = [
  {
    title: "Index (background)",
    body: "Sources become searchable chunks — court records, SEC filings, GitHub, jobs, news — stored with entity resolution.",
  },
  {
    title: "Retrieve + rerank",
    body: "Vector search pulls candidate passages for the company; reranking lifts the best evidence for the question.",
  },
  {
    title: "Grounded synthesis",
    body: "The model writes the analyst-style report from retrieved text — not open-web guessing — with citation-backed claims.",
  },
];

export function HowItWorksRag() {
  const frame = useCurrentFrame();

  return (
    <SceneShell>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          height: "100%",
          gap: 28,
        }}
      >
        <h2
          style={{
            fontSize: 38,
            fontWeight: 700,
            color: theme.text,
            fontFamily: theme.fontSans,
            opacity: spring({
              frame,
              fps: 30,
              config: { damping: 18, mass: 0.7, stiffness: 100 },
            }),
          }}
        >
          How the scan works (RAG)
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {steps.map((step, i) => {
            const delay = 12 + i * 55;
            const s = spring({
              frame: frame - delay,
              fps: 30,
              config: { damping: 17, mass: 0.65, stiffness: 105 },
            });
            return (
              <div
                key={step.title}
                style={{
                  padding: "22px 24px",
                  borderRadius: 14,
                  border: `1px solid ${theme.stroke}`,
                  backgroundColor: theme.bgElevated,
                  opacity: s,
                  transform: `translateY(${interpolate(s, [0, 1], [20, 0])}px)`,
                }}
              >
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: theme.accent,
                    marginBottom: 10,
                    fontFamily: theme.fontSans,
                  }}
                >
                  {step.title}
                </div>
                <div
                  style={{
                    fontSize: 26,
                    lineHeight: 1.45,
                    color: theme.muted,
                    fontFamily: theme.fontSans,
                  }}
                >
                  {step.body}
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 8,
            opacity: spring({
              frame: frame - 175,
              fps: 30,
              config: { damping: 18, mass: 0.7, stiffness: 95 },
            }),
          }}
        >
          {["Entity resolution", "Retrieve", "Grounded synthesis", "Citations"].map(
            (tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 22,
                  padding: "10px 16px",
                  borderRadius: 999,
                  border: `1px solid ${theme.stroke}`,
                  color: theme.text,
                  fontFamily: theme.fontMono,
                }}
              >
                {tag}
              </span>
            ),
          )}
        </div>
      </div>
    </SceneShell>
  );
}
