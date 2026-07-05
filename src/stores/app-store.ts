import { create } from "zustand";
import {
  activeVideo,
  chatMessages,
  transcript,
  videos,
  type ChatMessage,
  type TranscriptSegment,
  type Video,
} from "@/features/videos/data";

export type AppView = "library" | "add" | "watch" | "chat" | "settings";

const emptyChatMessages: ChatMessage[] = [];

type AppState = {
  currentView: AppView;
  libraryVideos: Video[];
  selectedVideo: Video;
  transcriptSegmentsByVideo: Record<string, TranscriptSegment[]>;
  chatMessagesByVideo: Record<string, ChatMessage[]>;
  subtitleEnabled: boolean;
  subtitleSize: number;
  subtitleOpacity: number;
  addVideo: (video: Video) => void;
  setTranscriptSegments: (
    videoId: string,
    segments: TranscriptSegment[],
  ) => void;
  getTranscriptSegments: (videoId: string) => TranscriptSegment[];
  getChatMessages: (videoId: string) => ChatMessage[];
  addChatExchange: (
    videoId: string,
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
  ) => void;
  setCurrentView: (view: AppView) => void;
  selectVideo: (videoId: string) => void;
  setSubtitleEnabled: (enabled: boolean) => void;
  setSubtitleSize: (value: number) => void;
  setSubtitleOpacity: (value: number) => void;
};

export const useAppStore = create<AppState>((set, get) => ({
  currentView: "library",
  libraryVideos: videos,
  selectedVideo: activeVideo,
  transcriptSegmentsByVideo: {
    [activeVideo.id]: transcript,
  },
  chatMessagesByVideo: {
    [activeVideo.id]: chatMessages,
  },
  subtitleEnabled: true,
  subtitleSize: 20,
  subtitleOpacity: 82,
  addVideo: (video) =>
    set((state) => {
      const existingVideo = state.libraryVideos.find(
        (libraryVideo) =>
          libraryVideo.youtubeVideoId === video.youtubeVideoId ||
          libraryVideo.id === video.id
      );

      if (existingVideo) {
        return {
          selectedVideo: existingVideo,
          currentView: "watch",
        };
      }

      return {
        libraryVideos: [video, ...state.libraryVideos],
        selectedVideo: video,
      };
    }),
  setTranscriptSegments: (videoId, segments) =>
    set((state) => ({
      transcriptSegmentsByVideo: {
        ...state.transcriptSegmentsByVideo,
        [videoId]: segments,
      },
    })),
  getTranscriptSegments: (videoId) => {
    const state = get();
    return state.transcriptSegmentsByVideo[videoId] ?? transcript;
  },
  getChatMessages: (videoId) => {
    const state = get();
    return state.chatMessagesByVideo[videoId] ?? emptyChatMessages;
  },
  addChatExchange: (videoId, userMessage, assistantMessage) =>
    set((state) => ({
      chatMessagesByVideo: {
        ...state.chatMessagesByVideo,
        [videoId]: [
          ...(state.chatMessagesByVideo[videoId] ?? []),
          userMessage,
          assistantMessage,
        ],
      },
    })),
  setCurrentView: (currentView) => set({ currentView }),
  selectVideo: (videoId) =>
    set((state) => ({
      selectedVideo:
        state.libraryVideos.find((video) => video.id === videoId) ??
        activeVideo,
      currentView: "watch",
    })),
  setSubtitleEnabled: (subtitleEnabled) => set({ subtitleEnabled }),
  setSubtitleSize: (subtitleSize) => set({ subtitleSize }),
  setSubtitleOpacity: (subtitleOpacity) => set({ subtitleOpacity }),
}));
