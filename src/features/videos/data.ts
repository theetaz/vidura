import type { LucideIcon } from "lucide-react";
import {
  AtomIcon,
  BrainCircuitIcon,
  CalculatorIcon,
  LanguagesIcon,
  OrbitIcon,
} from "lucide-react";

export type VideoStatus = "ready" | "processing" | "queued";

export type Video = {
  id: string;
  title: string;
  channel: string;
  category: string;
  duration: string;
  progress: string;
  status: VideoStatus;
  accent: string;
  Icon: LucideIcon;
};

export type TranscriptSegment = {
  id: string;
  time: string;
  original: string;
  sinhala: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citation?: string;
};

export const videos: Video[] = [
  {
    id: "quantum",
    title: "Quantum Physics Explained - Simply and Visually",
    channel: "Kurzgesagt - In a Nutshell",
    category: "Physics",
    duration: "22:47",
    progress: "Ready",
    status: "ready",
    accent: "bg-vidura-purple",
    Icon: OrbitIcon,
  },
  {
    id: "relativity",
    title: "The Theory of Relativity - Special Relativity",
    channel: "Veritasium",
    category: "Physics",
    duration: "19:12",
    progress: "Ready",
    status: "ready",
    accent: "bg-vidura-sky",
    Icon: AtomIcon,
  },
  {
    id: "equations",
    title: "The Beauty of Differential Equations",
    channel: "3Blue1Brown",
    category: "Math",
    duration: "18:35",
    progress: "Ready",
    status: "ready",
    accent: "bg-vidura-mint",
    Icon: CalculatorIcon,
  },
  {
    id: "black-holes",
    title: "Black Holes Explained - From Birth to Evaporation",
    channel: "Kurzgesagt - In a Nutshell",
    category: "Space",
    duration: "16:05",
    progress: "Translating",
    status: "processing",
    accent: "bg-vidura-coral",
    Icon: BrainCircuitIcon,
  },
];

export const transcript: TranscriptSegment[] = [
  {
    id: "t1",
    time: "04:06",
    original:
      "In quantum physics, particles can exist in multiple states until measured.",
    sinhala:
      "ක්වොන්ටම් භෞතිකයේ, මැනීමකට පෙර අංශු තත්ත්ව කිහිපයක තිබිය හැක.",
  },
  {
    id: "t2",
    time: "04:12",
    original:
      "This is called superposition, and it is one reason quantum behavior feels strange.",
    sinhala:
      "මෙය superposition ලෙස හැඳින්වෙයි. ඒ නිසා ක්වොන්ටම් හැසිරීම අසාමාන්‍ය ලෙස දැනේ.",
  },
  {
    id: "t3",
    time: "04:18",
    original:
      "Imagine a coin spinning in the air before it lands as heads or tails.",
    sinhala:
      "කාසියක් හිස හෝ වලිගය ලෙස වැටීමට පෙර වායුවේ කරකැවෙනවා කියා සිතන්න.",
  },
];

export const chatMessages: ChatMessage[] = [
  {
    id: "c1",
    role: "user",
    content: "Explain superposition in simple terms.",
    citation: "04:13",
  },
  {
    id: "c2",
    role: "assistant",
    content:
      "Superposition means a particle can be described as several possible states until it is measured. The video compares this to uncertainty before the final result is known.",
    citation: "04:12",
  },
];

export const categories = ["All", "Physics", "Math", "Space", "Biology"];

export const learningStats = [
  { label: "Videos processed", value: "3" },
  { label: "Sinhala lines", value: "1,284" },
  { label: "Questions asked", value: "18" },
];

export const activeVideo = videos[0];

export const languageOptions = [
  { value: "si", label: "Sinhala" },
  { value: "bi", label: "Bilingual" },
  { value: "en", label: "English" },
];

export const processingSteps = [
  { label: "Fetch transcript", state: "complete" },
  { label: "Translate to Sinhala", state: "complete" },
  { label: "Generate subtitles", state: "active" },
  { label: "Store in library", state: "pending" },
];

export const quickPrompts = [
  "Summarize this section",
  "Explain the term simply",
  "Give me an example",
  "Quiz me from this video",
];

export const emptyImportIcon = LanguagesIcon;

