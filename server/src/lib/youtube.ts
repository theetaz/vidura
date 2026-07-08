// YouTube URL parsing, metadata, and transcript extraction.
//
// The VPS's datacenter IP is hard-blocked by YouTube, so nothing here scrapes
// YouTube directly. Transcripts come from Gemini (Google fetches the public
// URL on its own infrastructure); metadata from the YouTube Data API or the
// keyless oembed endpoint. Desktop users can also push a transcript from the
// browser userscript (see routes/ingest.ts), which bypasses this module.

import {
  fetchMetadataViaDataApi,
  fetchMetadataViaOembed,
  fetchTranscriptViaGemini,
} from "./google.ts";

export type ParsedYouTubeUrl = {
  videoId: string;
  canonicalUrl: string;
};

export type NormalizedTranscriptSegment = {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type VideoMetadata = {
  title: string | null;
  channelTitle: string | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
};

export type YouTubeVideoData = {
  metadata: VideoMetadata;
  segments: NormalizedTranscriptSegment[];
};

const youtubeIdPattern = /^[a-zA-Z0-9_-]{11}$/;

export function parseYouTubeUrl(value: string): ParsedYouTubeUrl | null {
  const input = value.trim();
  if (!input) return null;

  const normalizedInput = input.startsWith("http") ? input : `https://${input}`;

  try {
    const url = new URL(normalizedInput);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
    let videoId: string | null = null;

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      videoId = url.searchParams.get("v") ??
        parseVideoIdFromPath(url.pathname, ["shorts", "embed", "live"]);
    }

    if (!videoId || !youtubeIdPattern.test(videoId)) {
      return null;
    }

    return {
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch {
    return null;
  }
}

function parseVideoIdFromPath(pathname: string, routeNames: string[]) {
  const [route, id] = pathname.split("/").filter(Boolean);
  if (!route || !routeNames.includes(route)) return null;
  return id ?? null;
}

export function fallbackMetadata(videoId: string): VideoMetadata {
  return {
    title: null,
    channelTitle: null,
    durationMs: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

// Transcript + metadata via Gemini (Google fetches the public YouTube URL, so
// the VPS IP block is irrelevant). Metadata comes from the Data API / oembed.
export async function fetchYouTubeVideoData(
  videoId: string,
): Promise<YouTubeVideoData> {
  const segments = await fetchTranscriptViaGemini(videoId);
  if (!segments || segments.length === 0) {
    throw new Error(
      "Couldn't get a transcript for this video. Configure GEMINI_API_KEY, " +
        "or add it from the browser transcript helper.",
    );
  }

  const metadata = await fetchYouTubeMetadata(videoId);
  return { metadata, segments };
}

// Metadata only (used when the client supplied the transcript, or alongside a
// Gemini transcript). Data API → keyless oembed → thumbnail-only fallback.
export async function fetchYouTubeMetadata(
  videoId: string,
): Promise<VideoMetadata> {
  return (await fetchMetadataViaDataApi(videoId)) ??
    (await fetchMetadataViaOembed(videoId)) ??
    fallbackMetadata(videoId);
}
