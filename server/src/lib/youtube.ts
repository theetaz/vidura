// YouTube URL parsing, metadata, and transcript extraction — ported from the
// Supabase edge functions. Runs on Bun/Node with global fetch.

import { env } from "../env.ts";

// All YouTube requests go through this so an optional residential proxy can be
// applied (YouTube blocks datacenter IPs). Bun's fetch supports a `proxy`
// option; when unset the request is direct.
function ytFetch(url: string, init?: RequestInit): Promise<Response> {
  const withProxy = env.youtubeProxyUrl
    ? { ...init, proxy: env.youtubeProxyUrl }
    : init;
  return fetch(url, withProxy as RequestInit);
}

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

type TranscriptLine = {
  text: string;
  duration: number;
  offset: number;
  lang: string;
};

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
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

export async function fetchYouTubeMetadata(
  videoId: string,
): Promise<VideoMetadata> {
  const fallback = {
    title: null,
    channelTitle: null,
    durationMs: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };

  const response = await ytFetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
  });

  if (!response.ok) return fallback;

  const html = await response.text();
  const playerResponse = parseInlineJson(html, "ytInitialPlayerResponse");
  const videoDetails = playerResponse?.videoDetails as
    | Record<string, unknown>
    | undefined;
  const thumbnails = ((videoDetails?.thumbnail as Record<string, unknown>)
    ?.thumbnails ?? []) as Array<Record<string, unknown>>;
  const bestThumbnail = thumbnails
    .filter((thumbnail) => typeof thumbnail.url === "string")
    .sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))[0];
  const lengthSeconds = Number(videoDetails?.lengthSeconds);

  return {
    title: typeof videoDetails?.title === "string" ? videoDetails.title : null,
    channelTitle: typeof videoDetails?.author === "string"
      ? videoDetails.author
      : null,
    durationMs: Number.isFinite(lengthSeconds) ? lengthSeconds * 1000 : null,
    thumbnailUrl: typeof bestThumbnail?.url === "string"
      ? bestThumbnail.url
      : fallback.thumbnailUrl,
  };
}

export async function fetchYouTubeTranscriptSegments(
  videoId: string,
): Promise<NormalizedTranscriptSegment[]> {
  const transcript = await fetchTranscriptLines(videoId);

  return transcript
    .map((segment, index) => {
      const startMs = normalizeTranscriptTime(segment.offset);
      const durationMs = normalizeTranscriptDuration(segment.duration);
      return {
        index,
        startMs,
        endMs: Math.max(startMs + 1, startMs + durationMs),
        text: segment.text.replace(/\s+/g, " ").trim(),
      };
    })
    .filter((segment) => segment.text && segment.endMs > segment.startMs)
    .slice(0, 500);
}

async function fetchTranscriptLines(videoId: string): Promise<TranscriptLine[]> {
  const tracks = await fetchCaptionTracks(videoId);
  const track = chooseCaptionTrack(tracks, "en");

  if (!track?.baseUrl) {
    // No caption tracks usually means YouTube blocked this (datacenter) IP
    // rather than the video genuinely lacking captions.
    throw new Error(
      `Couldn't fetch a transcript for ${videoId} — YouTube returned no caption tracks (the server IP may be blocked). Import a transcript file instead, or configure YOUTUBE_PROXY_URL.`,
    );
  }

  const transcriptXml = await fetchCaptionXml(track.baseUrl);
  const transcript = parseTranscriptXml(transcriptXml, track.languageCode ?? "en");

  if (transcript.length === 0) {
    throw new Error(`No transcript lines were parsed for ${videoId}`);
  }

  return transcript;
}

async function fetchCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const innerTubeResponse = await ytFetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
      },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
        videoId,
      }),
    },
  );

  if (innerTubeResponse.ok) {
    const payload = await innerTubeResponse.json() as any;
    const tracks = payload?.captions?.playerCaptionsTracklistRenderer
      ?.captionTracks;
    if (Array.isArray(tracks) && tracks.length > 0) return tracks;
  }

  const webResponse = await ytFetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
  });
  const html = await webResponse.text();
  const playerResponse = parseInlineJson(html, "ytInitialPlayerResponse");
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer
    ?.captionTracks;

  return Array.isArray(tracks) ? tracks : [];
}

function chooseCaptionTrack(tracks: CaptionTrack[], preferredLanguage: string) {
  const preferredTracks = tracks.filter((track) =>
    track.languageCode === preferredLanguage
  );

  return (
    preferredTracks.find((track) => track.kind !== "asr") ??
      preferredTracks[0] ??
      tracks.find((track) => track.kind !== "asr") ??
      tracks[0] ??
      null
  );
}

async function fetchCaptionXml(baseUrl: string) {
  const response = await ytFetch(baseUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)",
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube transcript request failed with ${response.status}`);
  }

  const body = await response.text();
  if (!body.trim()) {
    throw new Error("YouTube transcript response was empty");
  }

  return body;
}

function parseTranscriptXml(xml: string, lang: string): TranscriptLine[] {
  const paragraphMatches = xml.matchAll(
    /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g,
  );
  const paragraphResults = Array.from(paragraphMatches).flatMap((match) => {
    const startMs = Number(match[1]);
    const durationMs = Number(match[2]);
    const inner = match[3] ?? "";
    const wordMatches = Array.from(inner.matchAll(/<s[^>]*>([^<]*)<\/s>/g));
    const text = decodeEntities(
      wordMatches.length > 0
        ? wordMatches.map((wordMatch) => wordMatch[1]).join("")
        : inner.replace(/<[^>]+>/g, ""),
    ).trim();

    if (!text || !Number.isFinite(startMs) || !Number.isFinite(durationMs)) {
      return [];
    }

    return [{ text, duration: durationMs, offset: startMs, lang }];
  });

  if (paragraphResults.length > 0) return paragraphResults;

  return Array.from(
    xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g),
  ).flatMap((match) => {
    const offsetSeconds = Number(match[1]);
    const durationSeconds = Number(match[2]);
    const text = decodeEntities(match[3] ?? "").trim();

    if (
      !text || !Number.isFinite(offsetSeconds) ||
      !Number.isFinite(durationSeconds)
    ) {
      return [];
    }

    return [{
      text,
      duration: durationSeconds * 1000,
      offset: offsetSeconds * 1000,
      lang,
    }];
  });
}

function parseInlineJson(html: string, globalName: string) {
  const assignmentMatch = html.match(
    new RegExp(`(?:var\\s+)?${globalName}\\s*=\\s*\\{`),
  );
  if (!assignmentMatch || assignmentMatch.index === undefined) return null;

  const jsonStart = html.indexOf("{", assignmentMatch.index);
  let depth = 0;

  for (let index = jsonStart; index < html.length; index += 1) {
    if (html[index] === "{") {
      depth += 1;
    } else if (html[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)));
}

function normalizeTranscriptTime(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value <= 120 ? value * 1000 : value));
}

function normalizeTranscriptDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 4500;
  return Math.max(1, Math.floor(value <= 120 ? value * 1000 : value));
}
