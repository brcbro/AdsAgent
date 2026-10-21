import React from "react";
import { CalculateMetadataFunction, Composition } from "remotion";
import { AdComposition } from "./AdComposition";
import { AdProps, FPS, msToFrames } from "./types";

const defaultProps: AdProps = { segments: [] };

const calculateMetadata: CalculateMetadataFunction<AdProps> = ({ props }) => {
  const totalMs = props.segments.reduce((sum, s) => sum + s.durationMs, 0);
  const landscape = props.aspectRatio === "16:9";
  return {
    durationInFrames: Math.max(msToFrames(totalMs), 1),
    width: landscape ? 1920 : 1080,
    height: landscape ? 1080 : 1920,
  };
};

export const Root: React.FC = () => {
  return (
    <Composition
      id="AdComposition"
      component={AdComposition}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={30 * FPS}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
