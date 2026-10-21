import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile } from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import { AdProps, DEFAULT_CAPTION_STYLE, SegmentProps, msToFrames } from "./types";
import { Subtitles } from "./Subtitles";

loadFont("normal", {
  weights: ["600", "700", "800"],
  subsets: ["latin"],
  styles: ["normal", "italic"],
});

export const AdComposition: React.FC<AdProps> = ({
  segments,
  musicSrc,
  musicVolume = 0,
  musicStartMs = 0,
  captionStyle = DEFAULT_CAPTION_STYLE,
  avatarZoom = 1,
  muteAvatar = false,
  avatarVolume = 1.4,
}) => {
  let cursor = 0;
  const totalMs = segments.reduce((s, seg) => s + seg.durationMs, 0);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {musicSrc && musicVolume > 0 && (
        <Audio
          src={staticFile(musicSrc)}
          volume={musicVolume}
          startFrom={msToFrames(musicStartMs)}
          endAt={msToFrames(totalMs + musicStartMs)}
        />
      )}
      {segments.map((seg) => {
        const from = cursor;
        cursor += msToFrames(seg.durationMs);
        return (
          <Sequence key={seg.id} from={from} durationInFrames={msToFrames(seg.durationMs)}>
            <SegmentView
              segment={seg}
              captionStyle={captionStyle}
              avatarZoom={avatarZoom}
              muteAvatar={muteAvatar}
              avatarVolume={avatarVolume}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const SegmentView: React.FC<{
  segment: SegmentProps;
  captionStyle: typeof DEFAULT_CAPTION_STYLE;
  avatarZoom: number;
  muteAvatar: boolean;
  avatarVolume: number;
}> = ({ segment, captionStyle, avatarZoom, muteAvatar, avatarVolume }) => {
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {segment.avatarSrc && (
        <OffthreadVideo
          src={staticFile(segment.avatarSrc)}
          muted={muteAvatar}
          volume={muteAvatar ? 0 : avatarVolume}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${avatarZoom})`,
            transformOrigin: "center center",
          }}
        />
      )}
      {segment.beats
        .filter((b) => b.kind === "broll" && b.clipPath)
        .map((beat, i) => (
          <Sequence
            key={i}
            from={msToFrames(beat.startMs)}
            durationInFrames={msToFrames(beat.endMs - beat.startMs)}
          >
            <OffthreadVideo
              src={staticFile(beat.clipPath!)}
              muted
              startFrom={msToFrames(beat.clipInMs ?? 0)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Sequence>
        ))}
      <Subtitles words={segment.words} style={captionStyle} />
    </AbsoluteFill>
  );
};
