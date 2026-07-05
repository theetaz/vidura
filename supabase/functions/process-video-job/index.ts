import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

type StoredSegment = {
  id: string;
  segment_index: number;
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
          started_at?: string;
          finished_at?: string;
        };
        Relationships: [];
      };
      videos: {
        Row: {
          id: string;
        };
        Insert: Record<string, never>;
        Update: {
          status?: "translating" | "ready" | "failed";
          error_message?: string | null;
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

  const normalizedSegments = normalizeSegments(body.segments ?? []);

  if (!body.jobId || normalizedSegments.length === 0) {
    return jsonResponse(
      { error: "jobId and at least one transcript segment are required" },
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
    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "running",
      videoStatus: "translating",
      progress: 20,
    });

    const sourceLanguage = body.sourceLanguage ?? "en";
    const targetLanguage = body.targetLanguage ?? "si-LK";
    const storedSegments = await upsertTranscriptSegments(
      serviceClient,
      job.video_id,
      sourceLanguage,
      normalizedSegments,
    );

    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "running",
      videoStatus: "translating",
      progress: 45,
    });

    const translations = await translateSegments({
      apiKey: openRouterApiKey,
      model: openRouterModel,
      sourceLanguage,
      targetLanguage,
      segments: normalizedSegments,
    });

    await upsertTranslatedSegments(
      serviceClient,
      job.video_id,
      targetLanguage,
      openRouterModel,
      storedSegments,
      translations,
    );

    await updateJobState(serviceClient, job.id, job.video_id, {
      jobStatus: "ready",
      videoStatus: "ready",
      progress: 100,
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
    .slice(0, 120);
}

async function updateJobState(
  serviceClient: ServiceClient,
  jobId: string,
  videoId: string,
  state: {
    jobStatus: "running" | "ready" | "failed";
    videoStatus: "translating" | "ready" | "failed";
    progress: number;
    errorMessage?: string;
  },
) {
  const now = new Date().toISOString();
  const jobUpdate: Database["public"]["Tables"]["processing_jobs"]["Update"] = {
    status: state.jobStatus,
    progress: state.progress,
    error_message: state.errorMessage ?? null,
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

async function translateSegments(input: {
  apiKey: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: ReturnType<typeof normalizeSegments>;
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
              "Translate each segment. Keep the same index values. Return an array of objects with index and text.",
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

  return parseTranslationContent(content);
}

function parseTranslationContent(content: string): TranslationResult[] {
  const jsonText = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(jsonText);

  if (!Array.isArray(parsed)) {
    throw new Error("Translation response was not an array");
  }

  return parsed
    .map((item) => ({
      index: Number(item.index),
      text: String(item.text ?? "").trim(),
    }))
    .filter((item) => Number.isInteger(item.index) && item.text);
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
