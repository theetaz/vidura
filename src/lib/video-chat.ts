import type { TranscriptSegment } from "@/features/videos/data";

type LocalVideoReply = {
  content: string;
  citation?: string;
};

const STOP_WORDS = new Set([
  "about",
  "also",
  "and",
  "are",
  "can",
  "for",
  "from",
  "give",
  "how",
  "into",
  "is",
  "it",
  "me",
  "of",
  "the",
  "this",
  "to",
  "video",
  "what",
  "why",
  "with",
]);

export function createLocalVideoReply(
  question: string,
  transcriptSegments: TranscriptSegment[],
): LocalVideoReply {
  const trimmedQuestion = question.trim();

  if (transcriptSegments.length === 0) {
    return {
      content:
        "I need transcript lines before I can answer from this video. Import captions first, then ask again.",
    };
  }

  if (isSummaryPrompt(trimmedQuestion)) {
    const summarySegments = transcriptSegments.slice(0, 3);
    return {
      content: `This section focuses on ${summarySegments
        .map((segment) => segment.original)
        .join(" ")}`,
      citation: summarySegments[0]?.time,
    };
  }

  const bestSegment = findBestSegment(trimmedQuestion, transcriptSegments);
  const citation = bestSegment?.time;
  const answerSource = bestSegment?.original ?? transcriptSegments[0].original;

  return {
    content: `Based on the video, ${answerSource} In simple terms, this is the key idea to study before moving to the next part.`,
    citation,
  };
}

function isSummaryPrompt(question: string) {
  return /\b(summary|summarize|recap|section)\b/i.test(question);
}

function findBestSegment(
  question: string,
  transcriptSegments: TranscriptSegment[],
) {
  const questionTokens = tokenize(question);

  if (questionTokens.length === 0) {
    return transcriptSegments[0];
  }

  return transcriptSegments
    .map((segment) => ({
      segment,
      score: scoreSegment(segment, questionTokens),
    }))
    .sort((a, b) => b.score - a.score)[0]?.segment;
}

function scoreSegment(segment: TranscriptSegment, questionTokens: string[]) {
  const segmentTokens = new Set(
    tokenize(`${segment.original} ${segment.sinhala}`),
  );

  return questionTokens.reduce((score, token) => {
    if (segmentTokens.has(token)) {
      return score + 1;
    }

    return score;
  }, 0);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}
