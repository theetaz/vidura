import type { ChatMessage, TranscriptSegment, Video } from "@/features/videos/data";
import { emptyImportIcon } from "@/features/videos/data";
import { api, streamPost } from "@/lib/api";
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

// Shapes returned by the self-hosted API (camelCase DTOs).
type VideoDTO = {
  id: string;
  youtubeVideoId: string;
  youtubeUrl: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  targetLanguage: string;
  status: "queued" | "fetching_transcript" | "translating" | "ready" | "failed";
  errorMessage: string | null;
  createdAt: string;
  latestJob: ProcessingJob | null;
};

export const videoQueryKeys = {
  all: ["videos"] as const,
  detail: (videoId: string | null) => ["videos", videoId] as const,
  transcript: (videoId: string | null) => ["videos", videoId, "transcript"] as const,
  // videoId null = the library-wide chat thread.
  chat: (videoId: string | null) => ["videos", videoId, "chat"] as const,
  notes: (videoId: string | null) => ["videos", videoId, "notes"] as const,
};

export const chatSessionKeys = {
  list: ["chat-sessions"] as const,
  messages: (threadId: string | null) =>
    ["chat-sessions", threadId, "messages"] as const,
};

export const chatSettingsKey = ["chat-settings"] as const;

export type VideoNote = {
  id: string;
  videoId: string;
  timestampMs: number;
  content: string;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
};

export type ChatSettings = {
  responseLanguage: "auto" | "si" | "en" | "singlish";
  answerStyle: "concise" | "balanced" | "detailed";
  customInstructions: string;
  memoryDepth: "short" | "medium" | "long";
  retrievalDepth: "focused" | "standard" | "broad";
  creativity: "focused" | "balanced" | "creative";
};

export const defaultChatSettings: ChatSettings = {
  responseLanguage: "auto",
  answerStyle: "balanced",
  customInstructions: "",
  memoryDepth: "medium",
  retrievalDepth: "standard",
  creativity: "balanced",
};

// ---- Library / videos ----

export async function fetchLibraryVideos(): Promise<LibraryVideo[]> {
  const videos = await api.get<VideoDTO[]>("/api/videos");
  return videos.map(mapVideo);
}

export function fetchVideoTranscript(
  videoId: string | null,
): Promise<TranscriptSegment[]> {
  if (!videoId) return Promise.resolve([]);
  return api.get<TranscriptSegment[]>(`/api/videos/${videoId}/transcript`);
}

export async function createVideoJob(input: {
  youtubeUrl: string;
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  targetLanguage?: string;
  segments?: TranscriptSegment[];
}) {
  return api.post<{ video: VideoDTO; job: ProcessingJob }>("/api/videos", {
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
  });
}

export async function regenerateSubtitles(input: {
  videoId: string;
  targetLanguage?: string;
  rebuildContext?: boolean;
  regenerateTranscript?: boolean;
}) {
  return api.post(`/api/videos/${input.videoId}/regenerate`, {
    targetLanguage: input.targetLanguage ?? "si-LK",
    rebuildContext: input.rebuildContext ?? true,
    regenerateTranscript: input.regenerateTranscript ?? false,
  });
}

export async function resumeVideoJob(videoId: string) {
  await api.post(`/api/videos/${videoId}/resume`);
}

export async function deleteVideo(videoId: string) {
  await api.del(`/api/videos/${videoId}`);
}

// ---- Notes ----

export function fetchVideoNotes(videoId: string | null): Promise<VideoNote[]> {
  if (!videoId) return Promise.resolve([]);
  return api.get<VideoNote[]>(`/api/notes?videoId=${encodeURIComponent(videoId)}`);
}

export async function addVideoNote(input: {
  videoId: string;
  timestampMs: number;
  content: string;
}) {
  await api.post("/api/notes", input);
}

export async function deleteVideoNote(noteId: string) {
  await api.del(`/api/notes/${noteId}`);
}

// ---- Chat sessions ----

export function fetchChatMessages(videoId: string | null): Promise<ChatMessage[]> {
  if (!videoId) return Promise.resolve([]);
  return api.get<ChatMessage[]>(
    `/api/chat/messages?videoId=${encodeURIComponent(videoId)}`,
  );
}

export function fetchChatSessions(): Promise<ChatSession[]> {
  return api.get<ChatSession[]>("/api/chat/sessions");
}

export function fetchSessionMessages(threadId: string): Promise<ChatMessage[]> {
  return api.get<ChatMessage[]>(`/api/chat/sessions/${threadId}/messages`);
}

export async function renameChatSession(input: { threadId: string; title: string }) {
  await api.patch(`/api/chat/sessions/${input.threadId}`, { title: input.title });
}

export async function deleteChatSession(threadId: string) {
  await api.del(`/api/chat/sessions/${threadId}`);
}

// Streams a chat answer. threadId continues a saved session; when omitted the
// server opens a new one and reports its id via onThreadId.
export async function streamVideoChat(input: {
  videoId: string | null;
  threadId?: string | null;
  question: string;
  onDelta: (text: string) => void;
  onThreadId?: (threadId: string) => void;
}): Promise<void> {
  let finished = false;

  await streamPost(
    "/api/chat/send",
    {
      videoId: input.videoId,
      threadId: input.threadId ?? null,
      question: input.question,
    },
    (event) => {
      const type = event.type as string;
      if (type === "delta" && typeof event.text === "string") {
        input.onDelta(event.text);
      } else if (type === "meta" && typeof event.threadId === "string") {
        input.onThreadId?.(event.threadId);
      } else if (type === "error") {
        throw new Error(String(event.message ?? "Chat response failed."));
      } else if (type === "done") {
        finished = true;
      }
    },
  );

  if (!finished) {
    throw new Error("The chat response ended unexpectedly.");
  }
}

// ---- Chat settings ----

export function fetchChatSettings(): Promise<ChatSettings> {
  return api.get<ChatSettings>("/api/settings/chat");
}

export async function saveChatSettings(settings: ChatSettings) {
  await api.put("/api/settings/chat", settings);
}

// ---- Mappers ----

function mapVideo(video: VideoDTO): LibraryVideo {
  const latestJob = video.latestJob;
  const progress = latestJob
    ? `${latestJob.progress}%`
    : titleCase(video.status.replaceAll("_", " "));

  return {
    id: video.id,
    youtubeVideoId: video.youtubeVideoId,
    youtubeUrl: video.youtubeUrl,
    thumbnailUrl: video.thumbnailUrl ??
      `https://i.ytimg.com/vi/${video.youtubeVideoId}/hqdefault.jpg`,
    title: video.title,
    channel: video.channelTitle ?? "YouTube",
    category: "Imported",
    duration: video.durationMs ? formatDuration(video.durationMs / 1000) : "--:--",
    progress,
    status: mapVideoStatus(video.status),
    accent: accentForStatus(video.status),
    Icon: emptyImportIcon,
    createdAt: video.createdAt,
    latestJob,
  };
}

function mapVideoStatus(status: VideoDTO["status"]): Video["status"] {
  if (status === "ready") return "ready";
  if (status === "queued") return "queued";
  if (status === "failed") return "failed";
  return "processing";
}

function accentForStatus(status: VideoDTO["status"]) {
  if (status === "ready") return "bg-vidura-mint";
  if (status === "failed") return "bg-vidura-coral";
  return "bg-vidura-sky";
}

function timestampToMilliseconds(timestamp: string) {
  const [minutes = "0", seconds = "0"] = timestamp.split(":");
  return (Number(minutes) * 60 + Number(seconds)) * 1000;
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
