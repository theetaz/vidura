// Heuristic timestamp-quality assessment for a transcript, computed once at
// processing time and stored on the video row. The score cross-validates the
// segment timings against structural invariants (ordering, overlap, coverage
// of the video's runtime, cue density) and weights in how trustworthy the
// source itself is: YouTube's own captions are frame-accurate, while Gemini
// audio ASR can drift by a few seconds.

import type { NormalizedTranscriptSegment } from "./youtube.ts";

export type SubtitleSource = "ytdlp" | "gemini" | "uploaded";

export type SubtitleQuality = {
  score: number; // 0–100
  label: "excellent" | "good" | "fair" | "poor";
  source: SubtitleSource;
  metrics: {
    segmentCount: number;
    overlapCount: number;
    outOfOrderCount: number;
    invalidDurationCount: number;
    // Share of the video's runtime covered from first to last cue (0–1).
    // Null when the video duration is unknown.
    coverageRatio: number | null;
    largestGapMs: number;
  };
};

// Baseline confidence per source. YouTube caption timings are authored against
// the video clock; Gemini estimates them from audio and drifts.
const SOURCE_BASELINE: Record<SubtitleSource, number> = {
  ytdlp: 100,
  uploaded: 90,
  gemini: 72,
};

export function assessSubtitleQuality(
  segments: NormalizedTranscriptSegment[],
  durationMs: number | null,
  source: SubtitleSource,
): SubtitleQuality {
  let overlapCount = 0;
  let outOfOrderCount = 0;
  let invalidDurationCount = 0;
  let largestGapMs = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const cur = segments[i];
    if (!cur) continue;
    if (cur.endMs <= cur.startMs) invalidDurationCount += 1;

    const next = segments[i + 1];
    if (!next) continue;
    if (cur.endMs > next.startMs) overlapCount += 1;
    if (next.startMs < cur.startMs) outOfOrderCount += 1;
    const gap = next.startMs - cur.endMs;
    if (gap > largestGapMs) largestGapMs = gap;
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const coverageRatio = durationMs && durationMs > 0 && first && last
    ? Math.min(1, Math.max(0, (last.endMs - first.startMs) / durationMs))
    : null;

  let score = SOURCE_BASELINE[source];

  if (segments.length === 0) {
    score = 0;
  } else {
    // Overlapping cues make the player show the wrong line (subtitle lag).
    score -= Math.min(30, (overlapCount / segments.length) * 100);
    // Timestamps going backwards means the timeline itself is unreliable.
    score -= Math.min(25, (outOfOrderCount / segments.length) * 200);
    score -= Math.min(15, (invalidDurationCount / segments.length) * 100);
    // Cues stopping well short of the runtime = a truncated transcript.
    if (coverageRatio !== null && coverageRatio < 0.9) {
      score -= Math.min(30, (0.9 - coverageRatio) * 100);
    }
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  const label = score >= 90
    ? "excellent"
    : score >= 75
    ? "good"
    : score >= 55
    ? "fair"
    : "poor";

  return {
    score,
    label,
    source,
    metrics: {
      segmentCount: segments.length,
      overlapCount,
      outOfOrderCount,
      invalidDurationCount,
      coverageRatio: coverageRatio === null
        ? null
        : Math.round(coverageRatio * 100) / 100,
      largestGapMs,
    },
  };
}
