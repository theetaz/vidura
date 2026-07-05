import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

type CreateVideoJobBody = {
  youtubeUrl?: string;
  title?: string;
  targetLanguage?: string;
  segments?: TranscriptSegmentInput[];
};

type TranscriptSegmentInput = {
  startMs?: number;
  endMs?: number;
  text?: string;
};

type ParsedYouTubeUrl = {
  videoId: string;
  canonicalUrl: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const youtubeIdPattern = /^[a-zA-Z0-9_-]{11}$/;

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

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: "Supabase function environment is missing" },
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

  const parsedUrl = parseYouTubeUrl(body.youtubeUrl ?? "");

  if (!parsedUrl) {
    return jsonResponse(
      {
        error: "Paste a valid YouTube video, Shorts, embed, or youtu.be link.",
      },
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

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: video, error: videoError } = await serviceClient
    .from("videos")
    .upsert(
      {
        owner_id: user.id,
        youtube_video_id: parsedUrl.videoId,
        youtube_url: parsedUrl.canonicalUrl,
        title: sanitizeTitle(body.title) ??
          `YouTube lesson ${parsedUrl.videoId}`,
        thumbnail_url:
          `https://i.ytimg.com/vi/${parsedUrl.videoId}/hqdefault.jpg`,
        target_language: body.targetLanguage ?? "si-LK",
        status: "queued",
      },
      { onConflict: "owner_id,youtube_video_id" },
    )
    .select("id, youtube_video_id, youtube_url, title, status, created_at")
    .single();

  if (videoError || !video) {
    return jsonResponse({
      error: "Failed to create video",
      details: videoError,
    }, 500);
  }

  const { data: job, error: jobError } = await serviceClient
    .from("processing_jobs")
    .insert({
      owner_id: user.id,
      video_id: video.id,
      kind: "process_video",
      status: "queued",
      progress: 0,
      metadata: {
        stage: "queued",
        requested_language_code: body.targetLanguage ?? "si-LK",
        youtube_video_id: parsedUrl.videoId,
        has_uploaded_transcript: Array.isArray(body.segments) &&
          body.segments.length > 0,
      },
    })
    .select("id, video_id, status, progress, created_at")
    .single();

  if (jobError || !job) {
    return jsonResponse({
      error: "Failed to create processing job",
      details: jobError,
    }, 500);
  }

  EdgeRuntime.waitUntil(
    startProcessingJob({
      authorization,
      supabaseUrl,
      supabaseAnonKey,
      jobId: job.id,
      targetLanguage: body.targetLanguage ?? "si-LK",
      segments: body.segments ?? [],
    }),
  );

  return jsonResponse({ video, job }, 201);
});

async function startProcessingJob(input: {
  authorization: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  jobId: string;
  targetLanguage: string;
  segments: TranscriptSegmentInput[];
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
          targetLanguage: input.targetLanguage,
          sourceLanguage: "en",
          segments: input.segments,
        }),
      },
    );

    if (!response.ok) {
      console.error("process-video-job background start failed", {
        status: response.status,
        body: await response.text(),
      });
    }
  } catch (error) {
    console.error("process-video-job background start failed", error);
  }
}

async function parseBody(request: Request): Promise<CreateVideoJobBody | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseYouTubeUrl(value: string): ParsedYouTubeUrl | null {
  const input = value.trim();

  if (!input) {
    return null;
  }

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

  if (!routeNames.includes(route)) {
    return null;
  }

  return id ?? null;
}

function sanitizeTitle(title: string | undefined) {
  const normalizedTitle = title?.trim();

  if (!normalizedTitle) {
    return null;
  }

  return normalizedTitle.slice(0, 180);
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
