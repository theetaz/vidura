import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { videoQueryKeys } from "@/features/videos/api";
import { supabase } from "@/lib/supabase";

const realtimeTables = [
  "videos",
  "processing_jobs",
  "transcript_segments",
  "translated_segments",
  "chat_threads",
  "chat_messages",
  "video_notes",
] as const;

type RealtimeTable = (typeof realtimeTables)[number];

// How long to wait after the last realtime event before refetching. Translation
// batches insert ~100 translated_segments rows in quick bursts; without
// coalescing, every insert triggers its own refetch and the client floods
// itself with hundreds of REST requests.
const FLUSH_DELAY_MS = 400;

type PendingInvalidations = {
  library: boolean;
  transcriptVideoIds: Set<string>;
  noteVideoIds: Set<string>;
  chat: boolean;
};

export function useVideoRealtime(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !supabase) {
      return;
    }

    const client = supabase;
    const channel = client.channel("vidura-data-sync");
    const pending: PendingInvalidations = {
      library: false,
      transcriptVideoIds: new Set(),
      noteVideoIds: new Set(),
      chat: false,
    };
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const flush = () => {
      flushTimer = null;

      if (disposed) {
        return;
      }

      if (pending.library) {
        pending.library = false;
        void queryClient.invalidateQueries({
          queryKey: videoQueryKeys.all,
          exact: true,
        });
      }

      for (const videoId of pending.transcriptVideoIds) {
        void queryClient.invalidateQueries({
          queryKey: videoQueryKeys.transcript(videoId),
        });
      }
      pending.transcriptVideoIds.clear();

      for (const videoId of pending.noteVideoIds) {
        void queryClient.invalidateQueries({
          queryKey: videoQueryKeys.notes(videoId),
        });
      }
      pending.noteVideoIds.clear();

      if (pending.chat) {
        pending.chat = false;
        // chat_messages rows only carry thread_id, so the video cannot be
        // derived from the payload. Invalidate all chat queries instead —
        // only the actively viewed chat refetches.
        void queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "videos" && query.queryKey[2] === "chat",
        });
      }
    };

    const scheduleFlush = () => {
      if (!flushTimer) {
        flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
      }
    };

    for (const table of realtimeTables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          const videoId = getVideoId(payload.new ?? payload.old);
          markPending(pending, table, videoId);
          scheduleFlush();
        },
      );
    }

    channel.subscribe((status) => {
      // Refresh everything once when (re)connected so no events were missed
      // while the socket was down.
      if (status === "SUBSCRIBED") {
        void queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });
      }
    });

    return () => {
      disposed = true;

      if (flushTimer) {
        clearTimeout(flushTimer);
      }

      void client.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}

// Map each table to only the queries whose data actually comes from it, so a
// chat message doesn't refetch the transcript and a translated segment doesn't
// refetch the chat.
function markPending(
  pending: PendingInvalidations,
  table: RealtimeTable,
  videoId: string | null,
) {
  switch (table) {
    case "videos":
    case "processing_jobs":
      pending.library = true;
      break;
    case "transcript_segments":
    case "translated_segments":
      if (videoId) {
        pending.transcriptVideoIds.add(videoId);
      }
      break;
    case "video_notes":
      if (videoId) {
        pending.noteVideoIds.add(videoId);
      }
      break;
    case "chat_threads":
    case "chat_messages":
      pending.chat = true;
      break;
  }
}

function getVideoId(row: unknown) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;

  if (typeof record.video_id === "string") {
    return record.video_id;
  }

  if (typeof record.id === "string") {
    return record.id;
  }

  return null;
}
