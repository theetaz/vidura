import type { TranscriptSegment } from "@/features/videos/data";

type ParsedCue = {
  startMs: number;
  endMs: number;
  text: string;
};

export async function parseTranscriptFile(file: File) {
  const text = await file.text();
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "srt") {
    return cuesToTranscriptSegments(parseSrt(text));
  }

  if (extension === "vtt") {
    return cuesToTranscriptSegments(parseVtt(text));
  }

  if (extension === "txt") {
    return plainTextToTranscriptSegments(text);
  }

  throw new Error("Choose a `.srt`, `.vtt`, or `.txt` transcript file.");
}

function parseSrt(text: string): ParsedCue[] {
  return text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timeLineIndex = lines.findIndex((line) => line.includes("-->"));

      if (timeLineIndex === -1) {
        return [];
      }

      const [start, end] = lines[timeLineIndex].split("-->").map((part) =>
        part.trim()
      );
      const startMs = parseTimestamp(start);
      const endMs = parseTimestamp(end);
      const cueText = lines.slice(timeLineIndex + 1).join(" ");

      if (startMs === null || endMs === null || !cueText) {
        return [];
      }

      return [{ startMs, endMs, text: cueText }];
    });
}

function parseVtt(text: string): ParsedCue[] {
  return parseSrt(
    text
      .replace(/^WEBVTT[^\n]*\n/i, "")
      .replace(/^NOTE[\s\S]*?(?=\n{2,})/gm, ""),
  );
}

function parseTimestamp(value: string) {
  const cleanValue = value.split(/\s+/)[0].replace(",", ".");
  const parts = cleanValue.split(":");
  const secondsPart = parts.pop();
  const minutesPart = parts.pop();
  const hoursPart = parts.pop();

  if (!secondsPart || !minutesPart) {
    return null;
  }

  const seconds = Number(secondsPart);
  const minutes = Number(minutesPart);
  const hours = hoursPart ? Number(hoursPart) : 0;

  if ([seconds, minutes, hours].some((part) => Number.isNaN(part))) {
    return null;
  }

  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function cuesToTranscriptSegments(cues: ParsedCue[]): TranscriptSegment[] {
  return cues
    .filter((cue) => cue.endMs > cue.startMs)
    .map((cue, index) => ({
      id: `uploaded-${index}`,
      time: formatTimestamp(cue.startMs),
      original: cue.text,
      sinhala: cue.text,
    }));
}

function plainTextToTranscriptSegments(text: string): TranscriptSegment[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `plain-${index}`,
      time: formatTimestamp(index * 5000),
      original: line,
      sinhala: line,
    }));
}

function formatTimestamp(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${
    seconds.toString().padStart(2, "0")
  }`;
}

