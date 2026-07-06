export type ParsedYouTubeUrl = {
  videoId: string;
  canonicalUrl: string;
};

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export function parseYouTubeUrl(value: string): ParsedYouTubeUrl | null {
  const input = value.trim();

  if (!input) {
    return null;
  }

  const normalizedInput = input.startsWith("http")
    ? input
    : `https://${input}`;

  try {
    const url = new URL(normalizedInput);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
    let videoId: string | null = null;

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      videoId =
        url.searchParams.get("v") ??
        parseVideoIdFromPath(url.pathname, ["shorts", "embed", "live"]);
    }

    if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) {
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

export function isYouTubeVideoId(value?: string): value is string {
  return Boolean(value && YOUTUBE_ID_PATTERN.test(value));
}

export function buildYouTubeEmbedUrl(videoId: string) {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    enablejsapi: "1",
    origin: typeof window === "undefined" ? "" : window.location.origin,
  });

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function buildYouTubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function parseVideoIdFromPath(pathname: string, routeNames: string[]) {
  const [route, id] = pathname.split("/").filter(Boolean);

  if (!routeNames.includes(route)) {
    return null;
  }

  return id ?? null;
}
