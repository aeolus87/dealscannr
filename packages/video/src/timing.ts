/** 30 fps timeline — total ~82s */
export const FPS = 30;

export const FRAMES = {
  hook: 300,
  problem: 420,
  product: 300,
  rag: 660,
  investor: 540,
  cta: 240,
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
