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
};

type TranslationResult = {
  index: number;
  text: string;
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

  const { data: job, error: jobError } = await serviceClient
    .from("processing_jobs")
    .select("id, owner_id, video_id")
    .eq("id", body.jobId)
    .eq("owner_id", user.id)
    .single();

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

    const segmentsForThisInvocation = untranslatedSegments.slice(0, 100);
    const translations = await translateBatches({
      serviceClient,
      jobId: job.id,
      videoId: job.video_id,
      targetLanguage,
      sourceLanguage,
      model: openRouterModel,
      apiKey: openRouterApiKey,
      storedSegments,
      segments: segmentsForThisInvocation,
      totalSegments: transcriptSegments.length,
      initialTranslatedSegments: translatedCount,
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
          authorization,
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
  const jobUpdate: Database["public"]["Tables"]["processing_jobs"]["Update"] = {
    status: state.jobStatus,
    progress: state.progress,
    error_message: state.errorMessage ?? null,
    metadata: state.metadata,
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

function calculateTranslationProgress(position: number, totalSegments: number) {
  if (totalSegments <= 0) {
    return 25;
  }

  return Math.min(95, 25 + Math.floor((position / totalSegments) * 70));
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
  totalSegments: number;
  initialTranslatedSegments: number;
}) {
  const batches = chunkSegments(input.segments, 25).map((segments, index) => ({
    index,
    segments,
  }));
  const translations: TranslationResult[] = [];
  let nextBatchIndex = 0;
  let translatedSegments = input.initialTranslatedSegments;

  async function processNextBatch() {
    while (nextBatchIndex < batches.length) {
      const batch = batches[nextBatchIndex];
      nextBatchIndex += 1;
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
      });

      await upsertTranslatedSegments(
        input.serviceClient,
        input.videoId,
        input.targetLanguage,
        input.model,
        input.storedSegments,
        batchTranslations,
      );

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
  }

  const workerCount = Math.min(4, batches.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => processNextBatch()),
  );

  return translations;
}

async function translateSegmentBatch(input: {
  apiKey: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: NormalizedTranscriptSegment[];
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
        {
          role: "system",
          content:
            "You translate educational video transcript segments to Sinhala. Preserve meaning, terminology, and segment alignment. Return only valid JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            sourceLanguage: input.sourceLanguage,
            targetLanguage: input.targetLanguage,
            instructions:
              'Translate every segment. Keep each index value unchanged. Return one JSON object shaped as {"translations":[{"index":0,"text":"..."}]} and no other keys.',
            segments: input.segments.map((segment) => ({
              index: segment.index,
              text: segment.text,
            })),
          }),
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter translation failed with ${response.status}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenRouter returned an invalid translation response");
  }

  return parseTranslationContent(content, input.segments);
}

async function translateCompleteBatch(input: {
  apiKey: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: NormalizedTranscriptSegment[];
}) {
  const translations = await translateSegmentBatch(input);
  const translationByIndex = new Map(
    translations.map((translation) => [translation.index, translation]),
  );
  let missingSegments = input.segments.filter((segment) =>
    !translationByIndex.has(segment.index)
  );

  for (const retryBatch of chunkSegments(missingSegments, 8)) {
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
