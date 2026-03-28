export const FPS = 30;

export const FRAMES = {
  hook: 120,
  problem: 150,
  product: 210,
  rag: 180,
  investor: 165,
  cta: 105,
} as const;

export const FRAME_START = {
  hook: 0,
  problem: FRAMES.hook,
  product: FRAMES.hook + FRAMES.problem,
  rag: FRAMES.hook + FRAMES.problem + FRAMES.product,
  investor:
    FRAMES.hook + FRAMES.problem + FRAMES.product + FRAMES.rag,
  cta:
    FRAMES.hook +
    FRAMES.problem +
    FRAMES.product +
    FRAMES.rag +
    FRAMES.investor,
} as const;

export const TOTAL_FRAMES =
  FRAMES.hook +
  FRAMES.problem +
  FRAMES.product +
  FRAMES.rag +
  FRAMES.investor +
  FRAMES.cta;

export const SNAP = { damping: 22, mass: 0.35, stiffness: 280 } as const;
export const SLAM = { damping: 12, mass: 0.3, stiffness: 350 } as const;
