import { Sequence } from "remotion";
import { FRAMES, FRAME_START, TOTAL_FRAMES } from "../timing";
import { Cta } from "../sequences/Cta";
import { Hook } from "../sequences/Hook";
import { HowItWorksRag } from "../sequences/HowItWorksRag";
import { InvestorWhy } from "../sequences/InvestorWhy";
import { Problem } from "../sequences/Problem";
import { ProductMoment } from "../sequences/ProductMoment";

export const introXMetadata = {
  durationInFrames: TOTAL_FRAMES,
  fps: 30,
  width: 1920,
  height: 1080,
};

export function IntroX() {
  return (
    <>
      <Sequence from={FRAME_START.hook} durationInFrames={FRAMES.hook}>
        <Hook />
      </Sequence>
      <Sequence from={FRAME_START.problem} durationInFrames={FRAMES.problem}>
        <Problem />
      </Sequence>
      <Sequence from={FRAME_START.product} durationInFrames={FRAMES.product}>
        <ProductMoment />
      </Sequence>
      <Sequence from={FRAME_START.rag} durationInFrames={FRAMES.rag}>
        <HowItWorksRag />
      </Sequence>
      <Sequence from={FRAME_START.investor} durationInFrames={FRAMES.investor}>
        <InvestorWhy />
      </Sequence>
      <Sequence from={FRAME_START.cta} durationInFrames={FRAMES.cta}>
        <Cta />
      </Sequence>
    </>
  );
}
