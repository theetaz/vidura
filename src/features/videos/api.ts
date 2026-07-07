import type { ChatMessage, TranscriptSegment, Video } from "@/features/videos/data";
import { emptyImportIcon } from "@/features/videos/data";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { formatDuration } from "@/lib/time";

export type ProcessingJob = {
  id: string;
  videoId: string;
  status: "queued" | "running" | "ready" | "failed";
  progress: number;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type LibraryVideo = Video & {
  createdAt: string;
  latestJob: ProcessingJob | null;
};

type VideoRow = {
  id: string;
  youtube_video_id: string;
  youtube_url: string;
  title: string;
  channel_title: string | null;
  thumbnail_url: string | null;
  duration_ms: number | null;
  target_language: string;
  status: "queued" | "fetching_transcript" | "translating" | "ready" | "failed";
  error_message: string | null;
  created_at: string;
};

type JobRow = {
  id: string;
  video_id: string;
  status: "queued" | "running" | "ready" | "failed";
  progress: number;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type TranscriptRow = {
  id: string;
  segment_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
};

type TranslationRow = {
  segment_id: string;
  text: string;
  language_code: string;
};

type ChatThreadRow = {
  id: string;
};

type ChatMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type CreateVideoJobResponse = {
  video: {
    id: string;
    youtube_video_id: string;
    youtube_url: string;
    title: string;
    status: string;
    created_at: string;
  };
  job: {
    id: string;
    video_id: string;
    status: string;
    progress: number;
    created_at: string;
  };
};

type ProcessVideoJobResponse = {
  job: {
    id: string;
    status: string;
    progress: number;
  };
  video: {
    id: string;
    status: string;
  };
  translatedSegments: number;
};

export type RegenerateSubtitlesResponse = {
  video: {
    id: string;
    status: string;
  };
  job: {
    id: string;
    video_id: string;
    status: string;
    progress: number;
    created_at: string;
  };
};

export const videoQueryKeys = {
  all: ["videos"] as const,
  detail: (videoId: string | null) => ["videos", videoId] as const,
  transcript: (videoId: string | null) => ["videos", videoId, "transcript"] as const,
  // videoId null = the library-wide chat thread.
  chat: (videoId: string | null) => ["videos", videoId, "chat"] as const,
  notes: (videoId: string | null) => ["videos", videoId, "notes"] as const,
};

export type VideoNote = {
  id: string;
  videoId: string;
  timestampMs: number;
  content: string;
  createdAt: string;
};

export const chatSessionKeys = {
  list: ["chat-sessions"] as const,
  messages: (threadId: string | null) =>
    ["chat-sessions", threadId, "messages"] as const,
};

export type ChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
};

export async function fetchLibraryVideos(): Promise<LibraryVideo[]> {
  const client = requireSupabase();
  const { data: videoRows, error: videoError } = await client
    .from("videos")
    .select(
      "id, youtube_video_id, youtube_url, title, channel_title, thumbnail_url, duration_ms, target_language, status, error_message, created_at",
    )
    .order("created_at", { ascending: false });

  if (videoError) {
    throw videoError;
  }

  if (!videoRows || videoRows.length === 0) {
    return [];
  }

  const videoIds = videoRows.map((video) => video.id);
  const { data: jobRows, error: jobError } = await client
    .from("processing_jobs")
    .select(
      "id, video_id, status, progress, error_message, metadata, created_at, updated_at",
    )
    .in("video_id", videoIds)
    .order("created_at", { ascending: false });

  if (jobError) {
    throw jobError;
  }

  const latestJobByVideoId = new Map<string, ProcessingJob>();
  for (const job of (jobRows ?? []) as JobRow[]) {
    if (!latestJobByVideoId.has(job.video_id)) {
      latestJobByVideoId.set(job.video_id, mapJob(job));
    }
  }

  return (videoRows as VideoRow[]).map((video) =>
    mapVideo(video, latestJobByVideoId.get(video.id) ?? null)
  );
}

export async function fetchVideoTranscript(
  videoId: string | null,
): Promise<TranscriptSegment[]> {
  if (!videoId) {
    return [];
  }

  const client = requireSupabase();
  const { data: sourceRows, error: sourceError } = await client
    .from("transcript_segments")
    .select("id, segment_index, start_ms, end_ms, text")
    .eq("video_id", videoId)
    .order("segment_index", { ascending: true });

  if (sourceError) {
    throw sourceError;
  }

  if (!sourceRows || sourceRows.length === 0) {
    return [];
  }

  const segmentIds = sourceRows.map((segment) => segment.id);
  const { data: translationRows, error: translationError } = await client
    .from("translated_segments")
    .select("segment_id, text, language_code")
    .eq("video_id", videoId)
    .eq("language_code", "si-LK")
    .in("segment_id", segmentIds);

  if (translationError) {
    throw translationError;
  }

  const translationBySegmentId = new Map(
    ((translationRows ?? []) as TranslationRow[]).map((translation) => [
      translation.segment_id,
      translation.text,
    ]),
  );

  return (sourceRows as TranscriptRow[]).map((segment) => ({
    id: segment.id,
    time: formatTimestamp(segment.start_ms),
    startMs: segment.start_ms,
    endMs: segment.end_ms,
    original: segment.text,
    sinhala: translationBySegmentId.get(segment.id) ?? segment.text,
  }));
}

export async function fetchChatMessages(
  videoId: string | null,
): Promise<ChatMessage[]> {
  const client = requireSupabase();
  let threadQuery = client
    .from("chat_threads")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);

  // videoId null = the library-wide chat thread.
  threadQuery = videoId
    ? threadQuery.eq("video_id", videoId)
    : threadQuery.is("video_id", null);

  const { data: threads, error: threadError } = await threadQuery;

  if (threadError) {
    throw threadError;
  }

  const thread = (threads as ChatThreadRow[] | null)?.[0];

  if (!thread) {
    return [];
  }

  const { data: rows, error: messageError } = await client
    .from("chat_messages")
    .select("id, role, content, metadata, created_at")
    .eq("thread_id", thread.id)
    .neq("role", "system")
    .order("created_at", { ascending: true });

  if (messageError) {
    throw messageError;
  }

  return ((rows ?? []) as ChatMessageRow[]).map((message) => ({
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    citation: typeof message.metadata?.citation === "string"
      ? message.metadata.citation
      : undefined,
  }));
}

export async function createVideoJob(input: {
  youtubeUrl: string;
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  targetLanguage?: string;
  segments?: TranscriptSegment[];
}) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<CreateVideoJobResponse>(
    "create-video-job",
    {
      body: {
        youtubeUrl: input.youtubeUrl,
        title: input.title,
        channelTitle: input.channelTitle,
        thumbnailUrl: input.thumbnailUrl,
        targetLanguage: input.targetLanguage,
        segments: (input.segments ?? []).map((segment) => ({
          startMs: segment.startMs ?? timestampToMilliseconds(segment.time),
          endMs: segment.endMs ?? timestampToMilliseconds(segment.time) + 4500,
          text: segment.original,
        })),
      },
    },
  );

  if (error) {
    throw error;
  }

  if (!data?.video || !data.job) {
    throw new Error("The create-video-job function returned an invalid response.");
  }

  return data;
}

export async function processVideoJob(input: {
  jobId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: TranscriptSegment[];
}) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<ProcessVideoJobResponse>(
    "process-video-job",
    {
      body: {
        jobId: input.jobId,
        sourceLanguage: input.sourceLanguage ?? "en",
        targetLanguage: input.targetLanguage ?? "si-LK",
        segments: input.segments.map((segment) => ({
          startMs: segment.startMs ?? timestampToMilliseconds(segment.time),
          endMs: segment.endMs ?? timestampToMilliseconds(segment.time) + 4500,
          text: segment.original,
        })),
      },
    },
  );

  if (error) {
    throw error;
  }

  if (!data?.job || !data.video) {
    throw new Error("The process-video-job function returned an invalid response.");
  }

  return data;
}

export async function regenerateSubtitles(input: {
  videoId: string;
  targetLanguage?: string;
  rebuildContext?: boolean;
  regenerateTranscript?: boolean;
}) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<RegenerateSubtitlesResponse>(
    "regenerate-video-subtitles",
    {
      body: {
        videoId: input.videoId,
        targetLanguage: input.targetLanguage ?? "si-LK",
        rebuildContext: input.rebuildContext ?? true,
        regenerateTranscript: input.regenerateTranscript ?? false,
      },
    },
  );

  if (error) {
    throw error;
  }

  if (!data?.video || !data.job) {
    throw new Error(
      "The regenerate-video-subtitles function returned an invalid response.",
    );
  }

  return data;
}

export async function resumeVideoJob(jobId: string) {
  const client = requireSupabase();
  const { error } = await client.functions.invoke<ProcessVideoJobResponse>(
    "process-video-job",
    {
      body: {
        jobId,
        segments: [],
      },
    },
  );

  if (error) {
    throw error;
  }
}

export async function deleteVideo(videoId: string) {
  const client = requireSupabase();
  const { error } = await client.from("videos").delete().eq("id", videoId);

  if (error) {
    throw error;
  }
}

// Library chat sessions (threads without a video). Each visit to /chats
// starts a new session; old sessions are listed, renamed, deleted, resumed.
export async function fetchChatSessions(): Promise<ChatSession[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .is("video_id", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as Array<{
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
  }>).map((thread) => ({
    id: thread.id,
    title: thread.title?.trim() || "New chat",
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  }));
}

export async function renameChatSession(input: {
  threadId: string;
  title: string;
}) {
  const client = requireSupabase();
  const { error } = await client
    .from("chat_threads")
    .update({ title: input.title.trim().slice(0, 80) })
    .eq("id", input.threadId);

  if (error) {
    throw error;
  }
}

export async function deleteChatSession(threadId: string) {
  const client = requireSupabase();
  const { error } = await client
    .from("chat_threads")
    .delete()
    .eq("id", threadId);

  if (error) {
    throw error;
  }
}

export async function fetchSessionMessages(
  threadId: string,
): Promise<ChatMessage[]> {
  const client = requireSupabase();
  const { data: rows, error } = await client
    .from("chat_messages")
    .select("id, role, content, metadata, created_at")
    .eq("thread_id", threadId)
    .neq("role", "system")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return ((rows ?? []) as ChatMessageRow[]).map((message) => ({
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    citation: typeof message.metadata?.citation === "string"
      ? message.metadata.citation
      : undefined,
  }));
}

// Streams an answer from the video-chat edge function. videoId null asks the
// library-wide assistant. threadId continues a saved session; when omitted
// the server opens a new session and reports its id via onThreadId. onDelta
// receives incremental answer text; the promise resolves once the full
// answer has been persisted server-side.
export async function streamVideoChat(input: {
  videoId: string | null;
  threadId?: string | null;
  question: string;
  onDelta: (text: string) => void;
  onThreadId?: (threadId: string) => void;
}): Promise<void> {
  const client = requireSupabase();
  const {
    data: { session },
  } = await client.auth.getSession();

  if (!session) {
    throw new Error("You must be signed in to chat.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/video-chat`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      videoId: input.videoId,
      threadId: input.threadId ?? null,
      question: input.question,
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null) as
      | { error?: string }
      | null;
    throw new Error(detail?.error ?? "The chat service is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const payload = trimmed.slice(5).trim();

        if (!payload) {
          continue;
        }

        const event = JSON.parse(payload) as {
          type: "meta" | "delta" | "done" | "error";
          text?: string;
          message?: string;
          threadId?: string;
        };

        if (event.type === "delta" && event.text) {
          input.onDelta(event.text);
        } else if (event.type === "error") {
          throw new Error(event.message ?? "Chat response failed.");
        } else if (event.type === "meta" && event.threadId) {
          input.onThreadId?.(event.threadId);
        } else if (event.type === "done") {
          finished = true;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finished) {
    throw new Error("The chat response ended unexpectedly.");
  }
}

type VideoNoteRow = {
  id: string;
  video_id: string;
  timestamp_ms: number;
  content: string;
  created_at: string;
};

export async function fetchVideoNotes(
  videoId: string | null,
): Promise<VideoNote[]> {
  if (!videoId) {
    return [];
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from("video_notes")
    .select("id, video_id, timestamp_ms, content, created_at")
    .eq("video_id", videoId)
    .order("timestamp_ms", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as VideoNoteRow[]).map((note) => ({
    id: note.id,
    videoId: note.video_id,
    timestampMs: note.timestamp_ms,
    content: note.content,
    createdAt: note.created_at,
  }));
}

export async function addVideoNote(input: {
  videoId: string;
  timestampMs: number;
  content: string;
}) {
  const client = requireSupabase();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to add notes.");
  }

  const { error } = await client.from("video_notes").insert({
    owner_id: user.id,
    video_id: input.videoId,
    timestamp_ms: Math.max(0, Math.floor(input.timestampMs)),
    content: input.content,
  });

  if (error) {
    throw error;
  }
}

export async function deleteVideoNote(noteId: string) {
  const client = requireSupabase();
  const { error } = await client.from("video_notes").delete().eq("id", noteId);

  if (error) {
    throw error;
  }
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
}

function mapJob(job: JobRow): ProcessingJob {
  return {
    id: job.id,
    videoId: job.video_id,
    status: job.status,
    progress: job.progress,
    errorMessage: job.error_message,
    metadata: job.metadata ?? {},
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

function mapVideo(video: VideoRow, latestJob: ProcessingJob | null): LibraryVideo {
  const progress = latestJob
    ? `${latestJob.progress}%`
    : titleCase(video.status.replaceAll("_", " "));

  return {
    id: video.id,
    youtubeVideoId: video.youtube_video_id,
    youtubeUrl: video.youtube_url,
    thumbnailUrl: video.thumbnail_url ??
      `https://i.ytimg.com/vi/${video.youtube_video_id}/hqdefault.jpg`,
    title: video.title,
    channel: video.channel_title ?? "YouTube",
    category: "Imported",
    duration: video.duration_ms ? formatDuration(video.duration_ms / 1000) : "--:--",
    progress,
    status: mapVideoStatus(video.status),
    accent: accentForStatus(video.status),
    Icon: emptyImportIcon,
    createdAt: video.created_at,
    latestJob,
  };
}

function mapVideoStatus(status: VideoRow["status"]): Video["status"] {
  if (status === "ready") {
    return "ready";
  }

  if (status === "queued") {
    return "queued";
  }

  return "processing";
}

function accentForStatus(status: VideoRow["status"]) {
  if (status === "ready") {
    return "bg-vidura-mint";
  }

  if (status === "failed") {
    return "bg-vidura-coral";
  }

  return "bg-vidura-sky";
}

function timestampToMilliseconds(timestamp: string) {
  const [minutes = "0", seconds = "0"] = timestamp.split(":");
  return (Number(minutes) * 60 + Number(seconds)) * 1000;
}

function formatTimestamp(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${
    seconds.toString().padStart(2, "0")
  }`;
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
