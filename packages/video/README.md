# DealScannr — Remotion (X intro)

## Prerequisites

- **Node.js** (LTS)
- **FFmpeg** on your `PATH` — required for `remotion render`. See [Remotion — FFmpeg](https://www.remotion.dev/docs/ffmpeg/).

## Scripts

| Command | Description |
|--------|-------------|
| `npm run studio` | Open Remotion Studio (from this package) |
| `npm run render` | Render `IntroX` to `out/intro-x.mp4` |
| `npm run typecheck` | `tsc --noEmit` |

From the repo root:

- `npm run video:studio`
- `npm run video:render`

## X (Twitter) export

- **Composition:** `IntroX`
- **Resolution:** **1080×1920** (9:16 vertical) — good for mobile feed
- **FPS:** 30 (~82s total; see `src/timing.ts`)
- **Codec:** Default H.264 MP4 from Remotion CLI is suitable for X upload

### Optional render flags

Tune quality/size (example):

```bash
npx remotion render src/Root.tsx IntroX out/intro-x.mp4 --codec h264 --crf 18
```

### Captions

- On-screen copy is **burned into** the composition (silent autoplay friendly).
- For separate SRT, generate captions in your editor or extend with [@remotion/captions](https://www.remotion.dev/docs/captions/) later.

## Layout

- `src/Root.tsx` — registers compositions
- `src/compositions/IntroX.tsx` — timeline + `Sequence`s
- `src/sequences/*` — one chapter per beat (hook, problem, RAG, investor, CTA)
- `src/theme.ts` — colors / type

Rendered files go to `out/` (gitignored).
