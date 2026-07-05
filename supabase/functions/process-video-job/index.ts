import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { YoutubeTranscript } from "npm:youtube-transcript@1.3.1";

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
  segment_index: number;
};

type VideoMetadata = {
  title: string | null;
  channelTitle: string | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
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

    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "running",
      videoStatus: "fetching_transcript",
      progress: 5,
      metadata: {
        stage: "fetching_metadata",
        translated_segments: 0,
      },
    });

    const sourceLanguage = body.sourceLanguage ?? "en";
    const targetLanguage = body.targetLanguage ?? "si-LK";
    const metadata = await fetchYouTubeMetadata(video.youtube_video_id);

    await serviceClient
      .from("videos")
      .update({
        title: metadata.title ?? undefined,
        channel_title: metadata.channelTitle,
        thumbnail_url: metadata.thumbnailUrl ??
          `https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg`,
        duration_ms: metadata.durationMs,
        source_language: sourceLanguage,
        metadata: {
          youtube_metadata_fetched_at: new Date().toISOString(),
        },
      })
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

    const normalizedSegments = normalizeSegments(body.segments ?? []);
    const transcriptSegments = normalizedSegments.length > 0
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

    const storedSegments = await upsertTranscriptSegments(
      serviceClient,
      job.video_id,
      sourceLanguage,
      transcriptSegments,
    );

    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "running",
      videoStatus: "translating",
      progress: 25,
      metadata: {
        stage: "translating",
        total_segments: transcriptSegments.length,
        translated_segments: 0,
      },
    });

    const translations: TranslationResult[] = [];
    const batches = chunkSegments(transcriptSegments, 12);

    for (const [batchIndex, batch] of batches.entries()) {
      const translatedCount = translations.length;
      const currentSegment = batch[0];

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
          current_batch: batchIndex + 1,
          total_batches: batches.length,
          current_segment_index: currentSegment.index,
          current_segment_start_ms: currentSegment.startMs,
          current_segment_text: currentSegment.text,
        },
      });

      const batchTranslations = await translateSegmentBatch({
        apiKey: openRouterApiKey,
        model: openRouterModel,
        sourceLanguage,
        targetLanguage,
        segments: batch,
      });

      await upsertTranslatedSegments(
        serviceClient,
        job.video_id,
        targetLanguage,
        openRouterModel,
        storedSegments,
        batchTranslations,
      );
      translations.push(...batchTranslations);
    }

    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "ready",
      videoStatus: "ready",
      progress: 100,
      metadata: {
        stage: "ready",
        total_segments: transcriptSegments.length,
        translated_segments: translations.length,
      },
    });

    return jsonResponse({
      job: { id: job.id, status: "ready", progress: 100 },
      video: { id: job.video_id, status: "ready" },
      translatedSegments: translations.length,
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
  const startToken = `var ${globalName} = `;
  const startIndex = html.indexOf(startToken);

  if (startIndex === -1) {
    return null;
  }

  const jsonStart = startIndex + startToken.length;
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
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: "en",
  });

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
              "Translate every segment. Keep each index value unchanged. Return a JSON array of objects with index and text only.",
            segments: input.segments.map((segment) => ({
              index: segment.index,
              text: segment.text,
            })),
          }),
        },
      ],
      temperature: 0.2,
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
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const sourceIndexSet = new Set(
    sourceSegments.map((segment) => segment.index),
  );
  const translations = items.flatMap((item): TranslationResult[] => {
    const index = Number.isInteger(Number(item?.index))
      ? Number(item.index)
      : null;
    const text = String(item?.text ?? "").trim();

    if (index === null || !sourceIndexSet.has(index) || !text) {
      return [];
    }

    return [{ index, text }];
  });

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
