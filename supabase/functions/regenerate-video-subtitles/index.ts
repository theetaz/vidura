import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

type RegenerateVideoSubtitlesBody = {
  videoId?: string;
  targetLanguage?: string;
  rebuildContext?: boolean;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  if (!body?.videoId) {
    return jsonResponse({ error: "videoId is required" }, 400);
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
    .select("id, status, target_language")
    .eq("id", body.videoId)
    .eq("owner_id", user.id)
    .single();

  if (videoError || !video) {
    return jsonResponse({ error: "Video not found" }, 404);
  }

  const { count: transcriptCount, error: transcriptError } = await serviceClient
    .from("transcript_segments")
    .select("id", { count: "exact", head: true })
    .eq("video_id", video.id);

  if (transcriptError) {
    return jsonResponse({ error: "Failed to read transcript segments" }, 500);
  }

  if (!transcriptCount || transcriptCount === 0) {
    return jsonResponse(
      { error: "This video has no transcript to regenerate subtitles from." },
      400,
    );
  }

  const targetLanguage = body.targetLanguage ?? video.target_language ?? "si-LK";

  const { data: activeJob } = await serviceClient
    .from("processing_jobs")
    .select("id, status")
    .eq("video_id", video.id)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeJob) {
    return jsonResponse(
      { error: "This video is already being processed." },
      409,
    );
  }

  const { data: job, error: jobError } = await serviceClient
    .from("processing_jobs")
    .insert({
      owner_id: user.id,
      video_id: video.id,
      kind: "translate_segments",
      status: "queued",
      progress: 0,
      metadata: {
        stage: "queued",
        requested_language_code: targetLanguage,
        regenerate: true,
        rebuild_context: body.rebuildContext ?? true,
      },
    })
    .select("id, video_id, status, progress, created_at")
    .single();

  if (jobError || !job) {
    return jsonResponse({
      error: "Failed to create regeneration job",
      details: jobError,
    }, 500);
  }

  await serviceClient
    .from("videos")
    .update({
      status: "translating",
      error_message: null,
    })
    .eq("id", video.id);

  EdgeRuntime.waitUntil(
    startProcessingJob({
      authorization,
      supabaseUrl,
      supabaseAnonKey,
      jobId: job.id,
      targetLanguage,
      rebuildContext: body.rebuildContext ?? true,
    }),
  );

  return jsonResponse({ video: { id: video.id, status: "translating" }, job }, 201);
});

async function startProcessingJob(input: {
  authorization: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  jobId: string;
  targetLanguage: string;
  rebuildContext: boolean;
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
          segments: [],
          forceRetranslate: true,
          rebuildContext: input.rebuildContext,
        }),
      },
    );

    if (!response.ok) {
      console.error("process-video-job regeneration start failed", {
        status: response.status,
        body: await response.text(),
      });
    }
  } catch (error) {
    console.error("process-video-job regeneration start failed", error);
  }
}

async function parseBody(
  request: Request,
): Promise<RegenerateVideoSubtitlesBody | null> {
  try {
    return await request.json();
  } catch {
    return null;
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
