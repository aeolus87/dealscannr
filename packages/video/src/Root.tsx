import React from "react";
import { Composition, registerRoot } from "remotion";
import { IntroX, introXMetadata } from "./compositions/IntroX";

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="IntroX"
        component={IntroX}
        durationInFrames={introXMetadata.durationInFrames}
        fps={introXMetadata.fps}
        width={introXMetadata.width}
        height={introXMetadata.height}
      />
    </>
  );
};

registerRoot(RemotionRoot);
