// YouTube URL parsing, metadata, and transcript extraction.
//
// Transcript/metadata extraction uses yt-dlp (bundled in the container), which
// rotates player clients to get past YouTube's datacenter-IP bot wall — the
// hand-rolled innertube approach couldn't. An optional proxy is still honored.

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../env.ts";

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
const YTDLP_TIMEOUT_MS = 90_000;

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

function fallbackMetadata(videoId: string): VideoMetadata {
  return {
    title: null,
    channelTitle: null,
    durationMs: null,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

// Obtains BOTH metadata and the English transcript via yt-dlp. On a blocked
// datacenter IP this needs cookies (YOUTUBE_COOKIES_FILE) or a residential
// proxy (YOUTUBE_PROXY_URL); otherwise it fails with a clear error.
//
// A Cloudflare Worker relay was evaluated and rejected: YouTube serves flagged
// Cloudflare IPs a DECOY video whose response echoes the requested videoId but
// carries a different video's title and captions — undetectable and unsafe.
export async function fetchYouTubeVideoData(
  videoId: string,
): Promise<YouTubeVideoData> {
  const dir = await mkdtemp(join(tmpdir(), "vidura-yt-"));

  try {
    await runYtDlp([
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "en.*,en,-live_chat",
      "--sub-format",
      "json3",
      "--write-info-json",
      "--no-warnings",
      "--no-playlist",
      "--retries",
      "3",
      "-o",
      join(dir, "%(id)s"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    const files = await readdir(dir);
    const metadata = await readInfoJson(dir, files, videoId);

    // Prefer a manual English track; fall back to any en*.json3, then any json3.
    const subFile = files.find((f) => /\.en\.json3$/.test(f)) ??
      files.find((f) => /\.en[.-][^.]*\.json3$/.test(f)) ??
      files.find((f) => f.endsWith(".json3"));

    if (!subFile) {
      throw new Error(
        `Couldn't fetch a transcript for ${videoId} — no English captions are available for this video.`,
      );
    }

    const segments = parseJson3(await readFile(join(dir, subFile), "utf8"));
    if (segments.length === 0) {
      throw new Error(
        `Couldn't parse any transcript lines for ${videoId}.`,
      );
    }

    return { metadata, segments };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Metadata only (used when the user uploaded their own transcript).
export async function fetchYouTubeMetadata(
  videoId: string,
): Promise<VideoMetadata> {
  try {
    const { stdout } = await runYtDlp([
      "--skip-download",
      "--dump-single-json",
      "--no-warnings",
      "--no-playlist",
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    return infoToMetadata(JSON.parse(stdout), videoId);
  } catch {
    return fallbackMetadata(videoId);
  }
}

async function readInfoJson(
  dir: string,
  files: string[],
  videoId: string,
): Promise<VideoMetadata> {
  const infoFile = files.find((f) => f.endsWith(".info.json"));
  if (!infoFile) return fallbackMetadata(videoId);
  try {
    const info = JSON.parse(await readFile(join(dir, infoFile), "utf8"));
    return infoToMetadata(info, videoId);
  } catch {
    return fallbackMetadata(videoId);
  }
}

function infoToMetadata(info: any, videoId: string): VideoMetadata {
  const fallback = fallbackMetadata(videoId);
  return {
    title: typeof info?.title === "string" ? info.title : null,
    channelTitle: typeof info?.uploader === "string"
      ? info.uploader
      : typeof info?.channel === "string"
      ? info.channel
      : null,
    durationMs: typeof info?.duration === "number"
      ? Math.round(info.duration * 1000)
      : null,
    thumbnailUrl: typeof info?.thumbnail === "string"
      ? info.thumbnail
      : fallback.thumbnailUrl,
  };
}

// Parses YouTube's json3 caption format into normalized segments.
function parseJson3(raw: string): NormalizedTranscriptSegment[] {
  const data = JSON.parse(raw);
  const events = Array.isArray(data?.events) ? data.events : [];
  const out: NormalizedTranscriptSegment[] = [];
  let lastText = "";

  for (const event of events) {
    if (!Array.isArray(event?.segs)) continue;

    const text = event.segs
      .map((seg: any) => (typeof seg?.utf8 === "string" ? seg.utf8 : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    // Skip empties and consecutive duplicates (auto-caption rolling lines).
    if (!text || text === lastText) continue;
    lastText = text;

    const startMs = Math.max(0, Math.floor(Number(event.tStartMs) || 0));
    const durMs = Math.max(1, Math.floor(Number(event.dDurationMs) || 4500));

    out.push({
      index: out.length,
      startMs,
      endMs: startMs + durMs,
      text,
    });
  }

  return out.slice(0, 500);
}

async function runYtDlp(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const fullArgs = [...args];
  // Cookies from a logged-in session bypass YouTube's bot wall on flagged IPs.
  if (env.youtubeCookiesFile && existsSync(env.youtubeCookiesFile)) {
    fullArgs.unshift("--cookies", env.youtubeCookiesFile);
  }
  if (env.youtubeProxyUrl) {
    fullArgs.unshift("--proxy", env.youtubeProxyUrl);
  }

  const proc = Bun.spawn(["yt-dlp", ...fullArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // already exited
    }
  }, YTDLP_TIMEOUT_MS);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      const detail = stderr.split("\n").filter(Boolean).slice(-2).join(" ");
      throw new Error(`yt-dlp failed (${exitCode}): ${detail.slice(0, 300)}`);
    }

    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}
