import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatSessionKeys, videoQueryKeys } from "@/features/videos/api";
import { apiBaseUrl } from "@/lib/api";

// Tables the API emits change events for.
type ChangeTable =
  | "videos"
  | "processing_jobs"
  | "transcript_segments"
  | "translated_segments"
  | "chat_threads"
  | "chat_messages"
  | "video_notes";

// Coalesce bursts (translation inserts ~100 rows) before invalidating.
const FLUSH_DELAY_MS = 400;

type PendingInvalidations = {
  library: boolean;
  transcriptVideoIds: Set<string>;
  noteVideoIds: Set<string>;
  chat: boolean;
  chatSessions: boolean;
};

export function useVideoRealtime(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const pending: PendingInvalidations = {
      library: false,
      transcriptVideoIds: new Set(),
      noteVideoIds: new Set(),
      chat: false,
      chatSessions: false,
    };
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const flush = () => {
      flushTimer = null;
      if (disposed) return;

      if (pending.library) {
        pending.library = false;
        void queryClient.invalidateQueries({ queryKey: videoQueryKeys.all, exact: true });
      }
      for (const videoId of pending.transcriptVideoIds) {
        void queryClient.invalidateQueries({ queryKey: videoQueryKeys.transcript(videoId) });
      }
      pending.transcriptVideoIds.clear();
      for (const videoId of pending.noteVideoIds) {
        void queryClient.invalidateQueries({ queryKey: videoQueryKeys.notes(videoId) });
      }
      pending.noteVideoIds.clear();
      if (pending.chat) {
        pending.chat = false;
        void queryClient.invalidateQueries({
          predicate: (query) =>
            (query.queryKey[0] === "videos" && query.queryKey[2] === "chat") ||
            (query.queryKey[0] === "chat-sessions" && query.queryKey[2] === "messages"),
        });
      }
      if (pending.chatSessions) {
        pending.chatSessions = false;
        void queryClient.invalidateQueries({ queryKey: chatSessionKeys.list, exact: true });
      }
    };

    const scheduleFlush = () => {
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
    };

    // EventSource sends the session cookie automatically (same-site).
    const source = new EventSource(`${apiBaseUrl}/api/realtime`, {
      withCredentials: true,
    });

    source.onmessage = (message) => {
      let event: { type?: string; table?: ChangeTable; videoId?: string | null };
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type !== "change" || !event.table) return;

      markPending(pending, event.table, event.videoId ?? null);
      scheduleFlush();
    };

    // Refresh everything once on (re)connect so nothing is missed.
    source.onopen = () => {
      void queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });
    };

    return () => {
      disposed = true;
      if (flushTimer) clearTimeout(flushTimer);
      source.close();
    };
  }, [enabled, queryClient]);
}

function markPending(
  pending: PendingInvalidations,
  table: ChangeTable,
  videoId: string | null,
) {
  switch (table) {
    case "videos":
    case "processing_jobs":
      pending.library = true;
      break;
    case "transcript_segments":
    case "translated_segments":
      if (videoId) pending.transcriptVideoIds.add(videoId);
      break;
    case "video_notes":
      if (videoId) pending.noteVideoIds.add(videoId);
      break;
    case "chat_threads":
      pending.chatSessions = true;
      break;
    case "chat_messages":
      pending.chat = true;
      break;
  }
}
