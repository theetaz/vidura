import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { YoutubeTranscript } from "npm:youtube-transcript@1.3.1";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

type TranscriptSegmentInput = {
  startMs?: number;
  endMs?: number;
  text?: string;
};

type ProcessVideoJobBody = {
  jobId?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments?: TranscriptSegmentInput[];
  forceRetranslate?: boolean;
  rebuildContext?: boolean;
  forceRefetchTranscript?: boolean;
};

type TranslationResult = {
  index: number;
  text: string;
};

type TranslationContext = {
  topic: string;
  summary: string;
  audience: string;
  translationGuidelines: string;
  keyTerms: Array<{
    source: string;
    preferredSinhala: string;
  }>;
};

type NormalizedTranscriptSegment = {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
};

type StoredSegment = {
  id: string;
  video_id?: string;
  segment_index: number;
  start_ms?: number;
  end_ms?: number;
  text?: string;
};

type VideoMetadata = {
  title: string | null;
  channelTitle: string | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
};

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
};

type TranscriptLine = {
  text: string;
  duration: number;
  offset: number;
  lang: string;
};

type Database = {
  public: {
    Tables: {
      processing_jobs: {
        Row: {
          id: string;
          owner_id: string;
          video_id: string;
        };
        Insert: Record<string, never>;
        Update: {
          status?: "running" | "ready" | "failed";
          progress?: number;
          error_message?: string | null;
          metadata?: Record<string, unknown>;
          started_at?: string;
          finished_at?: string;
        };
        Relationships: [];
      };
      videos: {
        Row: {
          id: string;
          youtube_video_id: string;
          youtube_url: string;
        };
        Insert: Record<string, never>;
        Update: {
          title?: string;
          channel_title?: string | null;
          thumbnail_url?: string | null;
          duration_ms?: number | null;
          source_language?: string | null;
          status?: "fetching_transcript" | "translating" | "ready" | "failed";
          error_message?: string | null;
          metadata?: Record<string, unknown>;
        };
        Relationships: [];
      };
      transcript_segments: {
        Row: StoredSegment;
        Insert: {
          video_id: string;
          segment_index: number;
          start_ms: number;
          end_ms: number;
          source_language: string;
          text: string;
          normalized_text: string;
        };
        Update: {
          start_ms?: number;
          end_ms?: number;
          source_language?: string;
          text?: string;
          normalized_text?: string;
        };
        Relationships: [];
      };
      translated_segments: {
        Row: {
          id: string;
          segment_id: string;
          video_id: string;
          language_code: string;
        };
        Insert: {
          segment_id: string;
          video_id: string;
          language_code: string;
          text: string;
          model: string;
          version: number;
        };
        Update: {
          text?: string;
          model?: string;
          version?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type ServiceClient = SupabaseClient<Database>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";

// Supabase Edge Functions are hard-killed at the wall-clock limit (~150s)
// without running catch blocks, which previously left jobs stuck at
// "running". Stop starting new work after this budget and chain a fresh
// invocation instead, keeping every invocation far below the kill limit.
const INVOCATION_TIME_BUDGET_MS = 45_000;

// Per-LLM-call timeout. A hung upstream connection previously stalled the
// invocation until the runtime killed it silently.
const OPENROUTER_TIMEOUT_MS = 40_000;

// Segments per LLM call: large enough for passage-level Sinhala flow (the
// full transcript plus prior translations carry the context), small enough
// that each call reliably completes within the timeout and progress updates
// stay granular.
const TRANSLATION_BATCH_SIZE = 20;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  const openRouterModel = Deno.env.get("OPENROUTER_MODEL") ??
    "deepseek/deepseek-chat";

  if (
    !supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey ||
    !openRouterApiKey
  ) {
    return jsonResponse(
      { error: "Supabase or OpenRouter function environment is missing" },
      500,
    );
  }

  const invocationStartedAt = Date.now();
  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }

  const body = await parseBody(request);

  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.jobId) {
    return jsonResponse(
      { error: "jobId is required" },
      400,
    );
  }

  // Chained invocations authenticate with the service role key so that
  // long-running jobs cannot die when the original user JWT expires.
  const isServiceInvocation =
    authorization === `Bearer ${supabaseServiceRoleKey}`;

  const serviceClient: ServiceClient = createClient<Database>(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  let jobQuery = serviceClient
    .from("processing_jobs")
    .select("id, owner_id, video_id")
    .eq("id", body.jobId);

  if (!isServiceInvocation) {
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Invalid user session" }, 401);
    }

    jobQuery = jobQuery.eq("owner_id", user.id);
  }

  const { data: job, error: jobError } = await jobQuery.single();

  if (jobError || !job) {
    return jsonResponse({ error: "Processing job not found" }, 404);
  }

  try {
    const { data: video, error: videoError } = await serviceClient
      .from("videos")
      .select("id, youtube_video_id, youtube_url")
      .eq("id", job.video_id)
      .single();

    if (videoError || !video) {
      throw new Error("Video for processing job was not found");
    }

    const sourceLanguage = body.sourceLanguage ?? "en";
    const targetLanguage = body.targetLanguage ?? "si-LK";

    if (body.forceRefetchTranscript) {
      await updateJobState(serviceClient, job.id, job.video_id, {
        jobStatus: "running",
        videoStatus: "fetching_transcript",
        progress: 2,
        metadata: {
          stage: "clearing_transcript",
          translated_segments: 0,
        },
      });

      // Translated segments cascade-delete with their transcript segments.
      await deleteTranscriptSegments(serviceClient, job.video_id);
    }

    const existingStoredSegments = await fetchStoredTranscriptSegments(
      serviceClient,
      job.video_id,
    );
    const normalizedSegments = normalizeSegments(body.segments ?? []);
    let transcriptSegments = storedSegmentsToNormalized(existingStoredSegments);
    let storedSegments = existingStoredSegments;

    if (transcriptSegments.length === 0) {
      await updateJobState(serviceClient, job.id, job.video_id, {
        jobStatus: "running",
        videoStatus: "fetching_transcript",
        progress: 5,
        metadata: {
          stage: "fetching_metadata",
          translated_segments: 0,
        },
      });

      const metadata = await fetchYouTubeMetadata(video.youtube_video_id);
      const videoMetadataUpdate: Database["public"]["Tables"]["videos"][
        "Update"
      ] = {
        thumbnail_url: metadata.thumbnailUrl ??
          `https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg`,
        source_language: sourceLanguage,
        metadata: {
          youtube_metadata_fetched_at: new Date().toISOString(),
        },
      };

      if (metadata.title) {
        videoMetadataUpdate.title = metadata.title;
      }

      if (metadata.channelTitle) {
        videoMetadataUpdate.channel_title = metadata.channelTitle;
      }

      if (metadata.durationMs) {
        videoMetadataUpdate.duration_ms = metadata.durationMs;
      }

      await serviceClient
        .from("videos")
        .update(videoMetadataUpdate)
        .eq("id", job.video_id);

      await updateJobState(serviceClient, job.id, job.video_id, {
        jobStatus: "running",
        videoStatus: "fetching_transcript",
        progress: 12,
        metadata: {
          stage: "fetching_thumbnail",
          thumbnail_url: metadata.thumbnailUrl ??
            `https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg`,
        },
      });

      transcriptSegments = normalizedSegments.length > 0
        ? normalizedSegments
        : await fetchYouTubeTranscriptSegments(video.youtube_video_id);

      if (transcriptSegments.length === 0) {
        throw new Error("No transcript segments were available for this video");
      }

      await updateJobState(serviceClient, job.id, job.video_id, {
        jobStatus: "running",
        videoStatus: "fetching_transcript",
        progress: 20,
        metadata: {
          stage: "storing_transcript",
          total_segments: transcriptSegments.length,
          translated_segments: 0,
          transcript_source: normalizedSegments.length > 0
            ? "uploaded"
            : "youtube",
        },
      });

      storedSegments = await upsertTranscriptSegments(
        serviceClient,
        job.video_id,
        sourceLanguage,
        transcriptSegments,
      );
    }

    if (body.forceRetranslate) {
      await deleteTranslatedSegments(
        serviceClient,
        job.video_id,
        targetLanguage,
      );
    }

    const translatedSegmentIds = await fetchTranslatedSegmentIds(
      serviceClient,
      job.video_id,
      targetLanguage,
    );
    const segmentIdByIndex = new Map(
      storedSegments.map((segment) => [segment.segment_index, segment.id]),
    );
    const untranslatedSegments = transcriptSegments.filter((segment) => {
      const segmentId = segmentIdByIndex.get(segment.index);
      return segmentId ? !translatedSegmentIds.has(segmentId) : false;
    });
    const translatedCount = transcriptSegments.length -
      untranslatedSegments.length;

    const { data: jobRecord } = await serviceClient
      .from("processing_jobs")
      .select("metadata")
      .eq("id", job.id)
      .single();
    const existingMetadata = (jobRecord?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    let translationContext = body.rebuildContext
      ? null
      : parseTranslationContext(existingMetadata.translation_context);

    const { data: videoDetails } = await serviceClient
      .from("videos")
      .select("title, channel_title")
      .eq("id", job.video_id)
      .single();

    if (!translationContext) {
      await updateJobState(serviceClient, job.id, job.video_id, {
        jobStatus: "running",
        videoStatus: "translating",
        progress: calculateTranslationProgress(
          translatedCount,
          transcriptSegments.length,
        ),
        metadata: {
          ...existingMetadata,
          stage: "building_translation_context",
          total_segments: transcriptSegments.length,
          translated_segments: translatedCount,
        },
      });

      translationContext = await buildTranslationContext({
        apiKey: openRouterApiKey,
        model: openRouterModel,
        sourceLanguage,
        targetLanguage,
        videoTitle: videoDetails?.title ?? null,
        channelTitle: videoDetails?.channel_title ?? null,
        segments: transcriptSegments,
      });

      await mergeJobMetadata(serviceClient, job.id, {
        translation_context: translationContext,
      });
    }

    const existingTranslations = await fetchExistingTranslationsByIndex(
      serviceClient,
      job.video_id,
      targetLanguage,
      storedSegments,
    );

    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "running",
      videoStatus: "translating",
      progress: calculateTranslationProgress(
        translatedCount,
        transcriptSegments.length,
      ),
      metadata: {
        stage: "translating",
        total_segments: transcriptSegments.length,
        translated_segments: translatedCount,
        remaining_segments: untranslatedSegments.length,
      },
    });

    const translations = await translateBatches({
      serviceClient,
      jobId: job.id,
      videoId: job.video_id,
      targetLanguage,
      sourceLanguage,
      model: openRouterModel,
      apiKey: openRouterApiKey,
      storedSegments,
      segments: untranslatedSegments,
      allSegments: transcriptSegments,
      translationContext,
      videoTitle: videoDetails?.title ?? null,
      channelTitle: videoDetails?.channel_title ?? null,
      existingTranslations,
      totalSegments: transcriptSegments.length,
      initialTranslatedSegments: translatedCount,
      // Stop starting new batches once the invocation budget is spent; the
      // remainder is handed to a chained invocation below.
      hasTimeBudget: () =>
        Date.now() - invocationStartedAt < INVOCATION_TIME_BUDGET_MS,
    });
    const nextTranslatedCount = translatedCount + translations.length;

    if (nextTranslatedCount < transcriptSegments.length) {
      await updateJobState(serviceClient, job.id, job.video_id, {
        jobStatus: "running",
        videoStatus: "translating",
        progress: calculateTranslationProgress(
          nextTranslatedCount,
          transcriptSegments.length,
        ),
        metadata: {
          stage: "translating",
          total_segments: transcriptSegments.length,
          translated_segments: nextTranslatedCount,
          remaining_segments: transcriptSegments.length - nextTranslatedCount,
          chained_invocation: true,
        },
      });

      EdgeRuntime.waitUntil(
        startNextProcessingInvocation({
          // Chain with the service role key: user JWTs expire mid-job on
          // long videos, which silently killed the chain.
          authorization: `Bearer ${supabaseServiceRoleKey}`,
          supabaseUrl,
          supabaseAnonKey,
          jobId: job.id,
          sourceLanguage,
          targetLanguage,
        }),
      );

      return jsonResponse({
        job: {
          id: job.id,
          status: "running",
          progress: calculateTranslationProgress(
            nextTranslatedCount,
            transcriptSegments.length,
          ),
        },
        video: { id: job.video_id, status: "translating" },
        translatedSegments: nextTranslatedCount,
        remainingSegments: transcriptSegments.length - nextTranslatedCount,
      });
    }

    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "ready",
      videoStatus: "ready",
      progress: 100,
      metadata: {
        stage: "ready",
        total_segments: transcriptSegments.length,
        translated_segments: nextTranslatedCount,
      },
    });

    return jsonResponse({
      job: { id: job.id, status: "ready", progress: 100 },
      video: { id: job.video_id, status: "ready" },
      translatedSegments: nextTranslatedCount,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Video processing failed";

    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "failed",
      videoStatus: "failed",
      progress: 100,
      errorMessage: message,
      metadata: {
        stage: "failed",
        error: message,
      },
    });

    return jsonResponse({ error: message }, 500);
  }
});

async function parseBody(
  request: Request,
): Promise<ProcessVideoJobBody | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function normalizeSegments(segments: TranscriptSegmentInput[]) {
  return segments
    .map((segment, index) => ({
      index,
      startMs: Math.max(0, Math.floor(segment.startMs ?? index * 5000)),
      endMs: Math.max(
        1,
        Math.floor(segment.endMs ?? index * 5000 + 4500),
      ),
      text: segment.text?.trim() ?? "",
    }))
    .filter((segment) => segment.text && segment.endMs > segment.startMs)
    .slice(0, 500);
}

async function fetchYouTubeMetadata(videoId: string): Promise<VideoMetadata> {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    return {
      title: null,
      channelTitle: null,
      durationMs: null,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

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
      : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

function parseInlineJson(html: string, globalName: string) {
  const assignmentMatch = html.match(
    new RegExp(`(?:var\\s+)?${globalName}\\s*=\\s*\\{`),
  );

  if (!assignmentMatch || assignmentMatch.index === undefined) {
    return null;
  }

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

async function fetchYouTubeTranscriptSegments(
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

async function fetchTranscriptLines(
  videoId: string,
): Promise<TranscriptLine[]> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: "en",
    });

    if (transcript.length > 0) {
      return transcript.map((segment) => ({
        text: segment.text,
        duration: segment.duration,
        offset: segment.offset,
        lang: segment.lang ?? "en",
      }));
    }
  } catch (error) {
    console.warn("youtube-transcript package failed, using direct fallback", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const tracks = await fetchCaptionTracks(videoId);
  const track = chooseCaptionTrack(tracks, "en");

  if (!track?.baseUrl) {
    throw new Error(`No English transcript is available for ${videoId}`);
  }

  const transcriptXml = await fetchCaptionXml(track.baseUrl);
  const transcript = parseTranscriptXml(
    transcriptXml,
    track.languageCode ?? "en",
  );

  if (transcript.length === 0) {
    throw new Error(`No transcript lines were parsed for ${videoId}`);
  }

  return transcript;
}

async function fetchCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const innerTubeResponse = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
          },
        },
        videoId,
      }),
    },
  );

  if (innerTubeResponse.ok) {
    const payload = await innerTubeResponse.json();
    const tracks = payload?.captions?.playerCaptionsTracklistRenderer
      ?.captionTracks;

    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks;
    }
  }

  const webResponse = await fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    },
  );
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
  const response = await fetch(baseUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)",
    },
  });

  if (!response.ok) {
    throw new Error(
      `YouTube transcript request failed with ${response.status}`,
    );
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
    const inner = match[3];
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

  if (paragraphResults.length > 0) {
    return paragraphResults;
  }

  return Array.from(
    xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g),
  ).flatMap((match) => {
    const offsetSeconds = Number(match[1]);
    const durationSeconds = Number(match[2]);
    const text = decodeEntities(match[3]).trim();

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

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(
      /&#x([0-9a-fA-F]+);/g,
      (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(
      /&#(\d+);/g,
      (_, decimal: string) => String.fromCodePoint(parseInt(decimal, 10)),
    );
}

function normalizeTranscriptTime(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value <= 120 ? value * 1000 : value));
}

function normalizeTranscriptDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 4500;
  }

  return Math.max(1, Math.floor(value <= 120 ? value * 1000 : value));
}

async function updateJobState(
  serviceClient: ServiceClient,
  jobId: string,
  videoId: string,
  state: {
    jobStatus: "running" | "ready" | "failed";
    videoStatus: "fetching_transcript" | "translating" | "ready" | "failed";
    progress: number;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const now = new Date().toISOString();
  const { data: jobRecord } = await serviceClient
    .from("processing_jobs")
    .select("metadata")
    .eq("id", jobId)
    .single();
  const currentMetadata = (jobRecord?.metadata ?? {}) as Record<string, unknown>;
  const jobUpdate: Database["public"]["Tables"]["processing_jobs"]["Update"] = {
    status: state.jobStatus,
    progress: state.progress,
    error_message: state.errorMessage ?? null,
    metadata: state.metadata
      ? {
        ...currentMetadata,
        ...state.metadata,
      }
      : currentMetadata,
  };

  if (state.jobStatus === "running") {
    jobUpdate.started_at = now;
  } else {
    jobUpdate.finished_at = now;
  }

  await Promise.all([
    serviceClient
      .from("processing_jobs")
      .update(jobUpdate)
      .eq("id", jobId),
    serviceClient
      .from("videos")
      .update({
        status: state.videoStatus,
        error_message: state.errorMessage ?? null,
      })
      .eq("id", videoId),
  ]);
}

async function startNextProcessingInvocation(input: {
  authorization: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  jobId: string;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  try {
    const response = await fetch(
      `${input.supabaseUrl}/functions/v1/process-video-job`,
      {
        method: "POST",
        headers: {
          "Authorization": input.authorization,
          "Content-Type": "application/json",
          "apikey": input.supabaseAnonKey,
        },
        body: JSON.stringify({
          jobId: input.jobId,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          segments: [],
        }),
      },
    );

    if (!response.ok) {
      console.error("Chained process-video-job invocation failed", {
        status: response.status,
        body: await response.text(),
      });
    }
  } catch (error) {
    console.error("Chained process-video-job invocation failed", error);
  }
}

async function fetchStoredTranscriptSegments(
  serviceClient: ServiceClient,
  videoId: string,
) {
  const { data, error } = await serviceClient
    .from("transcript_segments")
    .select("id, segment_index, start_ms, end_ms, text")
    .eq("video_id", videoId)
    .order("segment_index", { ascending: true });

  if (error) {
    throw new Error("Failed to read stored transcript segments");
  }

  return (data ?? []) as StoredSegment[];
}

function storedSegmentsToNormalized(
  segments: StoredSegment[],
): NormalizedTranscriptSegment[] {
  return segments.flatMap((segment) => {
    if (
      typeof segment.start_ms !== "number" ||
      typeof segment.end_ms !== "number" ||
      typeof segment.text !== "string"
    ) {
      return [];
    }

    return [{
      index: segment.segment_index,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      text: segment.text,
    }];
  });
}

async function deleteTranscriptSegments(
  serviceClient: ServiceClient,
  videoId: string,
) {
  const { error } = await serviceClient
    .from("transcript_segments")
    .delete()
    .eq("video_id", videoId);

  if (error) {
    throw new Error("Failed to clear existing transcript segments");
  }
}

async function deleteTranslatedSegments(
  serviceClient: ServiceClient,
  videoId: string,
  targetLanguage: string,
) {
  const { error } = await serviceClient
    .from("translated_segments")
    .delete()
    .eq("video_id", videoId)
    .eq("language_code", targetLanguage);

  if (error) {
    throw new Error("Failed to clear existing translated segments");
  }
}

async function fetchTranslatedSegmentIds(
  serviceClient: ServiceClient,
  videoId: string,
  targetLanguage: string,
) {
  const { data, error } = await serviceClient
    .from("translated_segments")
    .select("segment_id")
    .eq("video_id", videoId)
    .eq("language_code", targetLanguage);

  if (error) {
    throw new Error("Failed to read translated segments");
  }

  return new Set(((data ?? []) as Array<{ segment_id: string }>).map((
    translation,
  ) => translation.segment_id));
}

async function upsertTranscriptSegments(
  serviceClient: ServiceClient,
  videoId: string,
  sourceLanguage: string,
  segments: ReturnType<typeof normalizeSegments>,
) {
  const { data, error } = await serviceClient
    .from("transcript_segments")
    .upsert(
      segments.map((segment) => ({
        video_id: videoId,
        segment_index: segment.index,
        start_ms: segment.startMs,
        end_ms: segment.endMs,
        source_language: sourceLanguage,
        text: segment.text,
        normalized_text: segment.text.toLowerCase(),
      })),
      { onConflict: "video_id,segment_index" },
    )
    .select("id, segment_index");

  if (error || !data) {
    throw new Error("Failed to store transcript segments");
  }

  return data as StoredSegment[];
}

function chunkSegments<T>(segments: T[], size: number) {
  const batches: T[][] = [];

  for (let index = 0; index < segments.length; index += size) {
    batches.push(segments.slice(index, index + size));
  }

  return batches;
}

function formatFullTranscriptForPrompt(
  segments: NormalizedTranscriptSegment[],
) {
  return segments
    .map((segment) => `[${segment.index}] ${segment.text}`)
    .join("\n");
}

function buildTranslationSystemPrompt(
  translationContext: TranslationContext,
  allSegments: NormalizedTranscriptSegment[],
) {
  const keyTerms = translationContext.keyTerms.length > 0
    ? translationContext.keyTerms
      .map((term) => `${term.source} → ${term.preferredSinhala}`)
      .join("; ")
    : "Use consistent native Sinhala terms throughout.";

  return [
    "You localize educational YouTube subtitles into natural spoken Sinhala (සිංහල).",
    "You have already read the ENTIRE transcript of this video. Never translate lines in isolation.",
    "Work passage by passage: first understand what the speaker is saying across the whole stretch of segments, compose it as natural spoken Sinhala, then distribute that Sinhala across the segment indices in speaking order.",
    "A single sentence often spans several consecutive segments. Let the Sinhala sentence flow across those indices — do NOT restart sentence grammar at every index, and do NOT force each index to be a self-contained sentence.",
    "Each subtitle must read like continuous native Sinhala narration that fits the video topic, tone, and teaching style, and must connect smoothly to the previous and next subtitle.",
    "Avoid word-for-word English calques, awkward sentence order, and unnecessary transliteration.",
    "Prefer idiomatic Sinhala phrasing that a native speaker would use while explaining the same idea on video.",
    "",
    `Topic: ${translationContext.topic}`,
    `Summary: ${translationContext.summary}`,
    `Audience: ${translationContext.audience}`,
    `Style guide: ${translationContext.translationGuidelines}`,
    `Key terms: ${keyTerms}`,
    "",
    "Full source transcript (read for global context; translate only requested indices):",
    formatFullTranscriptForPrompt(allSegments),
    "",
    "Return only valid JSON.",
  ].join("\n");
}

function calculateTranslationProgress(position: number, totalSegments: number) {
  if (totalSegments <= 0) {
    return 25;
  }

  return Math.min(95, 25 + Math.floor((position / totalSegments) * 70));
}

async function mergeJobMetadata(
  serviceClient: ServiceClient,
  jobId: string,
  metadataPatch: Record<string, unknown>,
) {
  const { data: jobRecord, error } = await serviceClient
    .from("processing_jobs")
    .select("metadata")
    .eq("id", jobId)
    .single();

  if (error) {
    throw new Error("Failed to read processing job metadata");
  }

  const currentMetadata = (jobRecord?.metadata ?? {}) as Record<string, unknown>;
  const { error: updateError } = await serviceClient
    .from("processing_jobs")
    .update({
      metadata: {
        ...currentMetadata,
        ...metadataPatch,
      },
    })
    .eq("id", jobId);

  if (updateError) {
    throw new Error("Failed to update processing job metadata");
  }
}

function parseTranslationContext(value: unknown): TranslationContext | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const topic = typeof record.topic === "string" ? record.topic.trim() : "";
  const summary = typeof record.summary === "string"
    ? record.summary.trim()
    : "";
  const audience = typeof record.audience === "string"
    ? record.audience.trim()
    : "";
  const translationGuidelines =
    typeof record.translationGuidelines === "string"
      ? record.translationGuidelines.trim()
      : "";
  const keyTerms = Array.isArray(record.keyTerms)
    ? record.keyTerms.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const term = item as Record<string, unknown>;
      const source = typeof term.source === "string" ? term.source.trim() : "";
      const preferredSinhala = typeof term.preferredSinhala === "string"
        ? term.preferredSinhala.trim()
        : "";

      if (!source || !preferredSinhala) {
        return [];
      }

      return [{ source, preferredSinhala }];
    })
    : [];

  if (!topic || !summary || !translationGuidelines) {
    return null;
  }

  return {
    topic,
    summary,
    audience: audience || "Sinhala-speaking learners",
    translationGuidelines,
    keyTerms,
  };
}

async function fetchExistingTranslationsByIndex(
  serviceClient: ServiceClient,
  videoId: string,
  targetLanguage: string,
  storedSegments: StoredSegment[],
) {
  const segmentIdByIndex = new Map(
    storedSegments.map((segment) => [segment.id, segment.segment_index]),
  );
  const segmentIds = storedSegments.map((segment) => segment.id);
  const translationsByIndex = new Map<number, string>();

  if (segmentIds.length === 0) {
    return translationsByIndex;
  }

  const { data, error } = await serviceClient
    .from("translated_segments")
    .select("segment_id, text")
    .eq("video_id", videoId)
    .eq("language_code", targetLanguage)
    .in("segment_id", segmentIds);

  if (error) {
    throw new Error("Failed to read existing translated segments");
  }

  for (const row of (data ?? []) as Array<{ segment_id: string; text: string }>) {
    const index = segmentIdByIndex.get(row.segment_id);

    if (typeof index === "number" && row.text.trim()) {
      translationsByIndex.set(index, row.text.trim());
    }
  }

  return translationsByIndex;
}

async function requestOpenRouterJson<T>(input: {
  apiKey: string;
  model: string;
  system: string;
  user: Record<string, unknown>;
  temperature?: number;
}) {
  let lastError: unknown = null;

  // One retry: a single flaky upstream response must not fail the whole job,
  // but persistent failures must surface quickly instead of hanging until
  // the runtime kills the invocation.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestOpenRouterJsonOnce<T>(input);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenRouter request failed");
}

async function requestOpenRouterJsonOnce<T>(input: {
  apiKey: string;
  model: string;
  system: string;
  user: Record<string, unknown>;
  temperature?: number;
}) {
  const response = await fetch(openRouterUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://vidura.local",
      "X-Title": "Vidura",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        {
          role: "user",
          content: JSON.stringify(input.user),
        },
      ],
      temperature: input.temperature ?? 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with ${response.status}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenRouter returned an invalid JSON response");
  }

  const jsonText = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  return JSON.parse(jsonText) as T;
}

async function buildTranslationContext(input: {
  apiKey: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  videoTitle: string | null;
  channelTitle: string | null;
  segments: NormalizedTranscriptSegment[];
}) {
  const parsed = await requestOpenRouterJson<Record<string, unknown>>({
    apiKey: input.apiKey,
    model: input.model,
    system:
      "You analyze full YouTube transcripts and prepare localization guidance for natural spoken Sinhala subtitles. The goal is fluent native Sinhala that fits the video, not literal one-to-one translation. Return only valid JSON.",
    user: {
      task:
        "Read the entire transcript first, then produce translation context a Sinhala subtitle localizer will follow.",
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      videoTitle: input.videoTitle,
      channelTitle: input.channelTitle,
      transcript: input.segments.map((segment) => ({
        index: segment.index,
        text: segment.text,
      })),
      instructions:
        'Return one JSON object shaped as {"topic":"...","summary":"...","audience":"...","translationGuidelines":"...","keyTerms":[{"source":"...","preferredSinhala":"..."}]}. The summary must capture the whole video arc. translationGuidelines must explicitly instruct the translator to: (1) read the full transcript before each batch, (2) write composed native Sinhala a learner would hear in a Sri Lankan educational video, (3) avoid literal English word order and calques, (4) keep terminology consistent, and (5) keep lines concise for on-screen subtitles.',
    },
    temperature: 0.1,
  });

  const context = parseTranslationContext(parsed);

  if (!context) {
    throw new Error("Failed to build translation context");
  }

  return context;
}

function buildPriorTranslations(
  batchSegments: NormalizedTranscriptSegment[],
  existingTranslations: Map<number, string>,
  limit = 250,
) {
  const firstIndex = batchSegments[0]?.index ?? 0;

  return Array.from(existingTranslations.entries())
    .filter(([index]) => index < firstIndex)
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .slice(-limit)
    .map(([index, text]) => ({ index, text }));
}

async function translateBatches(input: {
  serviceClient: ServiceClient;
  jobId: string;
  videoId: string;
  apiKey: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  storedSegments: StoredSegment[];
  segments: NormalizedTranscriptSegment[];
  allSegments: NormalizedTranscriptSegment[];
  translationContext: TranslationContext;
  videoTitle: string | null;
  channelTitle: string | null;
  existingTranslations: Map<number, string>;
  totalSegments: number;
  initialTranslatedSegments: number;
  hasTimeBudget: () => boolean;
}) {
  const batches = chunkSegments(input.segments, TRANSLATION_BATCH_SIZE).map(
    (segments, index) => ({
      index,
      segments,
    }),
  );
  const translations: TranslationResult[] = [];
  const translationsByIndex = new Map(input.existingTranslations);
  let translatedSegments = input.initialTranslatedSegments;

  for (const batch of batches) {
    if (!input.hasTimeBudget()) {
      break;
    }

    const currentSegment = batch.segments[0];

    await updateJobState(input.serviceClient, input.jobId, input.videoId, {
      jobStatus: "running",
      videoStatus: "translating",
      progress: calculateTranslationProgress(
        translatedSegments,
        input.totalSegments,
      ),
      metadata: {
        stage: "translating",
        total_segments: input.totalSegments,
        translated_segments: translatedSegments,
        active_batch: batch.index + 1,
        total_batches: batches.length,
        current_segment_index: currentSegment.index,
        current_segment_start_ms: currentSegment.startMs,
        current_segment_text: currentSegment.text,
      },
    });

    const batchTranslations = await translateCompleteBatch({
      apiKey: input.apiKey,
      model: input.model,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      segments: batch.segments,
      allSegments: input.allSegments,
      translationContext: input.translationContext,
      videoTitle: input.videoTitle,
      channelTitle: input.channelTitle,
      priorTranslations: buildPriorTranslations(
        batch.segments,
        translationsByIndex,
      ),
    });

    await upsertTranslatedSegments(
      input.serviceClient,
      input.videoId,
      input.targetLanguage,
      input.model,
      input.storedSegments,
      batchTranslations,
    );

    for (const translation of batchTranslations) {
      translationsByIndex.set(translation.index, translation.text);
    }

    translations.push(...batchTranslations);
    translatedSegments += batchTranslations.length;

    await updateJobState(input.serviceClient, input.jobId, input.videoId, {
      jobStatus: "running",
      videoStatus: "translating",
      progress: calculateTranslationProgress(
        translatedSegments,
        input.totalSegments,
      ),
      metadata: {
        stage: "translating",
        total_segments: input.totalSegments,
        translated_segments: translatedSegments,
        completed_batches: batch.index + 1,
        total_batches: batches.length,
      },
    });
  }

  return translations;
}

async function translateSegmentBatch(input: {
  apiKey: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: NormalizedTranscriptSegment[];
  allSegments: NormalizedTranscriptSegment[];
  translationContext: TranslationContext;
  videoTitle: string | null;
  channelTitle: string | null;
  priorTranslations: Array<{ index: number; text: string }>;
}) {
  const parsed = await requestOpenRouterJson<Record<string, unknown>>({
    apiKey: input.apiKey,
    model: input.model,
    system: buildTranslationSystemPrompt(
      input.translationContext,
      input.allSegments,
    ),
    user: {
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      videoTitle: input.videoTitle,
      channelTitle: input.channelTitle,
      videoContext: input.translationContext,
      priorSinhalaTranslations: input.priorTranslations,
      segmentsToTranslate: input.segments.map((segment) => ({
        index: segment.index,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
      })),
      instructions:
        'Using the full transcript already provided in the system message, translate ONLY segmentsToTranslate, covering every requested index exactly once. First compose the passage as natural spoken Sinhala, then distribute it across the indices in speaking order — a sentence may flow across consecutive indices, so do not restart grammar at each index. The first line must continue naturally from the last entry of priorSinhalaTranslations. Do not mirror English grammar. Rephrase freely when needed so each line sounds spoken and relevant to the video. Keep each line short enough for on-screen subtitles. Return one JSON object shaped as {"translations":[{"index":0,"text":"..."}]} and no other keys.',
    },
    temperature: 0.4,
  });

  return parseTranslationContent(
    JSON.stringify(parsed),
    input.segments,
  );
}

async function translateCompleteBatch(input: {
  apiKey: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: NormalizedTranscriptSegment[];
  allSegments: NormalizedTranscriptSegment[];
  translationContext: TranslationContext;
  videoTitle: string | null;
  channelTitle: string | null;
  priorTranslations: Array<{ index: number; text: string }>;
}) {
  const translations = await translateSegmentBatch(input);
  const translationByIndex = new Map(
    translations.map((translation) => [translation.index, translation]),
  );
  let missingSegments = input.segments.filter((segment) =>
    !translationByIndex.has(segment.index)
  );

  for (const retryBatch of chunkSegments(missingSegments, 25)) {
    const retryTranslations = await translateSegmentBatch({
      ...input,
      segments: retryBatch,
    });

    for (const translation of retryTranslations) {
      translationByIndex.set(translation.index, translation);
    }
  }

  missingSegments = input.segments.filter((segment) =>
    !translationByIndex.has(segment.index)
  );

  if (missingSegments.length > 0) {
    throw new Error(
      `Translation response missed ${missingSegments.length} segment(s)`,
    );
  }

  return input.segments.map((segment) =>
    translationByIndex.get(segment.index)!
  );
}

function parseTranslationContent(
  content: string,
  sourceSegments: NormalizedTranscriptSegment[],
): TranslationResult[] {
  const jsonText = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(jsonText);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.translations)
    ? parsed.translations
    : [parsed];
  const sourceIndexSet = new Set(
    sourceSegments.map((segment) => segment.index),
  );
  const translations = (items as unknown[]).flatMap(
    (item): TranslationResult[] => {
      const record = item as Record<string, unknown>;
      const index = Number.isInteger(Number(record.index))
        ? Number(record.index)
        : null;
      const text = String(record.text ?? "").trim();

      if (index === null || !sourceIndexSet.has(index) || !text) {
        return [];
      }

      return [{ index, text }];
    },
  );

  if (translations.length === 0) {
    throw new Error("Translation response did not include text");
  }

  return translations;
}

async function upsertTranslatedSegments(
  serviceClient: ServiceClient,
  videoId: string,
  targetLanguage: string,
  model: string,
  storedSegments: StoredSegment[],
  translations: TranslationResult[],
) {
  const segmentIdByIndex = new Map(
    storedSegments.map((segment) => [segment.segment_index, segment.id]),
  );
  const rows = translations.flatMap((translation) => {
    const segmentId = segmentIdByIndex.get(translation.index);

    if (!segmentId) {
      return [];
    }

    return {
      segment_id: segmentId,
      video_id: videoId,
      language_code: targetLanguage,
      text: translation.text,
      model,
      version: 1,
    };
  });

  if (rows.length === 0) {
    throw new Error("No translated segments matched source segments");
  }

  const { error } = await serviceClient
    .from("translated_segments")
    .upsert(rows, { onConflict: "segment_id,language_code,version" });

  if (error) {
    throw new Error("Failed to store translated segments");
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
