// Types for the native motion helpers used by src/ (docs/MOTION.md).
export function springFrames(
  spec: {duration: number; bounce?: number},
  frameAt: (progress: number) => Keyframe,
): {keyframes: Keyframe[]; duration: number};
