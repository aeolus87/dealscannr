import React from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "../theme";

type SceneShellProps = {
  children: React.ReactNode;
  accent?: boolean;
};

export function SceneShell({ children, accent }: SceneShellProps) {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        backgroundImage: accent
          ? `radial-gradient(ellipse 80% 60% at 50% 18%, ${theme.accentSoft}, transparent 55%), radial-gradient(ellipse 100% 80% at 50% 100%, rgba(251,191,36,0.06), transparent 50%)`
          : `radial-gradient(ellipse 90% 70% at 50% 0%, rgba(255,255,255,0.04), transparent 45%)`,
        boxSizing: "border-box",
        padding: "72px 56px",
      }}
    >
      <div
        style={{
          width: `${theme.safeWidthPct * 100}%`,
          maxWidth: "100%",
          margin: "0 auto",
          height: "100%",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}
