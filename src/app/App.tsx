import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BadgeCheckIcon,
  BellIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CirclePlayIcon,
  ClockIcon,
  Trash2Icon,
  DownloadIcon,
  FilterIcon,
  HistoryIcon,
  HomeIcon,
  LinkIcon,
  ListVideoIcon,
  Loader2Icon,
  LogOutIcon,
  Maximize2Icon,
  MenuIcon,
  Minimize2Icon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  PauseIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  SquarePenIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/features/auth/use-auth";
import {
  addVideoNote,
  chatSessionKeys,
  createVideoJob,
  deleteChatSession,
  deleteVideo,
  deleteVideoNote,
  fetchChatMessages,
  fetchChatSessions,
  fetchLibraryVideos,
  fetchSessionMessages,
  fetchVideoNotes,
  fetchVideoTranscript,
  regenerateSubtitles,
  renameChatSession,
  resumeVideoJob,
  streamVideoChat,
  videoQueryKeys,
  type LibraryVideo,
} from "@/features/videos/api";
import { useVideoRealtime } from "@/features/videos/use-video-realtime";
import {
  languageOptions,
  quickPrompts,
  type TranscriptSegment,
} from "@/features/videos/data";
import { hasSupabaseConfig } from "@/lib/supabase";
import { fetchDevYouTubeVideoData, parseTranscriptFile } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import {
  buildYouTubeWatchUrl,
  isYouTubeVideoId,
  parseYouTubeUrl,
} from "@/lib/youtube";
import { useAppStore, type AppView, type SubtitlePlacement } from "@/stores/app-store";
import {
  CartoonButton,
  MascotBubble,
  StickerCard,
  StickerPanel,
} from "@/components/vidura/cartoon";

const navItems: Array<{
  view: AppView;
  label: string;
  Icon: typeof HomeIcon;
  path: string;
}> = [
    { view: "library", label: "Library", Icon: HomeIcon, path: "/library" },
    { view: "add", label: "Add", Icon: PlusIcon, path: "/add" },
    { view: "watch", label: "Watch", Icon: CirclePlayIcon, path: "/watch" },
    { view: "chat", label: "Chats", Icon: MessageCircleIcon, path: "/chats" },
    { view: "settings", label: "Settings", Icon: SettingsIcon, path: "/settings" },
  ];

function App() {
  return (
    <TooltipProvider>
      <ViduraApp />
    </TooltipProvider>
  );
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function viewFromPath(pathname: string): AppView {
  if (pathname.startsWith("/add")) {
    return "add";
  }

  if (pathname.startsWith("/watch") || pathname.startsWith("/processing")) {
    return "watch";
  }

  if (pathname.startsWith("/chats")) {
    return "chat";
  }

  if (pathname.startsWith("/settings")) {
    return "settings";
  }

  return "library";
}

function navPathFor(view: AppView, selectedVideoId: string | null) {
  if (view === "watch" && selectedVideoId) {
    return `/watch/${selectedVideoId}`;
  }

  // "Chats" always opens the library-wide assistant; per-video chat lives on
  // the watch screen.
  return navItems.find((item) => item.view === view)?.path ?? "/library";
}

let youtubeIframeApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Could not load YouTube player."));
    document.head.append(script);
  });

  return youtubeIframeApiPromise;
}

function ViduraApp() {
  const selectedVideoId = useAppStore((state) => state.selectedVideoId);
  const setSelectedVideoId = useAppStore((state) => state.setSelectedVideoId);
  const location = useLocation();
  const auth = useAuth();
  const videosQuery = useLibraryVideos(auth.configured && Boolean(auth.session));
  // The chat page is a full-height flex column so its composer pins directly
  // above the bottom nav instead of floating in reserved padding.
  const isChatRoute = location.pathname.startsWith("/chats");

  useVideoRealtime(auth.configured && Boolean(auth.session));
  useStaleJobRecovery(videosQuery.data);

  useEffect(() => {
    if (!videosQuery.data) {
      return;
    }

    if (videosQuery.data.length === 0) {
      setSelectedVideoId(null);
      return;
    }

    const selectedVideoStillExists = videosQuery.data.some(
      (video) => video.id === selectedVideoId,
    );

    if (!selectedVideoStillExists) {
      setSelectedVideoId(videosQuery.data[0].id);
    }
  }, [selectedVideoId, setSelectedVideoId, videosQuery.data]);

  if (auth.loading) {
    return <LoadingScreen />;
  }

  if (auth.configured && !auth.session) {
    return <AuthScreen onSignIn={auth.signInWithGoogle} />;
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1760px] flex-col lg:flex-row">
        <DesktopSidebar />
        <main
          className={cn(
            "min-w-0 flex-1 px-4 pt-4 sm:px-6 lg:px-6 xl:px-7",
            isChatRoute
              // Clear the floating nav (~4.75rem mobile / ~5.25rem sm) plus a
              // small gap, instead of the 9rem reserved for scrolling pages,
              // and become a flex column so the chat section fills the exact
              // remaining height with its composer just above the nav.
              ? "flex flex-col overflow-hidden pb-[5.5rem] sm:pb-24 lg:pb-7"
              : "pb-36 sm:pb-40 lg:pb-7",
          )}
        >
          <TopBar />
          <Routes>
            <Route element={<Navigate replace to="/library" />} path="/" />
            <Route
              element={
                <LibraryScreen
                  error={videosQuery.error}
                  isPending={videosQuery.isPending}
                  videos={videosQuery.data ?? []}
                />
              }
              path="/library"
            />
            <Route element={<AddVideoScreen />} path="/add" />
            <Route element={<ProcessingRoute />} path="/processing/:videoId" />
            <Route
              element={<WatchScreen videos={videosQuery.data ?? []} />}
              path="/watch"
            />
            <Route
              element={<WatchScreen videos={videosQuery.data ?? []} />}
              path="/watch/:videoId"
            />
            <Route element={<ChatScreen />} path="/chats" />
            <Route element={<ChatScreen />} path="/chats/session/:threadId" />
            <Route element={<SettingsScreen />} path="/settings" />
            <Route element={<Navigate replace to="/library" />} path="*" />
          </Routes>
        </main>
        <MobileNav />
      </div>
    </div>
  );
}

function useLibraryVideos(enabled: boolean) {
  // Realtime (useVideoRealtime) is the primary update signal; polling is only
  // a safety net for missed events, so keep it slow to avoid competing
  // request storms while jobs are running.
  return useQuery({
    queryKey: videoQueryKeys.all,
    queryFn: fetchLibraryVideos,
    enabled,
    refetchInterval: (query) =>
      hasActiveVideoJob(query.state.data as LibraryVideo[] | undefined)
        ? 5_000
        : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
  });
}

// A running job that hasn't written a progress update in this long is
// considered dead: the edge runtime kills invocations at its wall-clock limit
// without running catch blocks, which used to leave jobs stuck at "running"
// forever. process-video-job is resumable (it only translates missing
// segments), so kicking it once brings the job back to life.
const STALE_JOB_THRESHOLD_MS = 150_000;
const STALE_JOB_RETRY_COOLDOWN_MS = 120_000;

function useStaleJobRecovery(videos: LibraryVideo[] | undefined) {
  const queryClient = useQueryClient();
  const attemptsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!videos) {
      return;
    }

    for (const video of videos) {
      const job = video.latestJob;

      if (!job || (job.status !== "running" && job.status !== "queued")) {
        continue;
      }

      const updatedAt = new Date(job.updatedAt).getTime();

      if (
        Number.isNaN(updatedAt) ||
        Date.now() - updatedAt < STALE_JOB_THRESHOLD_MS
      ) {
        continue;
      }

      const lastAttempt = attemptsRef.current.get(job.id) ?? 0;

      if (Date.now() - lastAttempt < STALE_JOB_RETRY_COOLDOWN_MS) {
        continue;
      }

      attemptsRef.current.set(job.id, Date.now());
      void resumeVideoJob(job.id).then(() =>
        queryClient.invalidateQueries({ queryKey: videoQueryKeys.all })
      ).catch((resumeError) => {
        console.error("Failed to resume stale job", job.id, resumeError);
      });
    }
  }, [videos, queryClient]);
}

function hasActiveVideoJob(videos: LibraryVideo[] | undefined) {
  return videos?.some((video) => {
    const jobStatus = video.latestJob?.status;

    return video.status !== "ready" || jobStatus === "queued" ||
      jobStatus === "running";
  }) ?? false;
}

function isVideoStillProcessing(video: LibraryVideo | null | undefined) {
  if (!video) {
    return false;
  }

  const jobStatus = video.latestJob?.status;

  return video.status !== "ready" || jobStatus === "queued" ||
    jobStatus === "running";
}

function InlineLoadingNotice({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-black text-foreground/65">
      <Loader2Icon className="size-4 shrink-0 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <StickerCard className="w-full max-w-sm">
        <CardContent className="flex items-center gap-3 p-5">
          <div className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          <p className="font-black">Loading Vidura...</p>
        </CardContent>
      </StickerCard>
    </main>
  );
}

function AuthScreen({
  onSignIn,
}: {
  onSignIn: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    setSubmitting(true);
    setError("");

    try {
      await onSignIn();
      setSubmitting(false);
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Could not start Google sign in.",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <StickerCard className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-lg border-2 border-foreground bg-vidura-sun shadow-[3px_3px_0_var(--vidura-ink)]">
              <BookOpenIcon />
            </div>
            <div>
              <CardTitle className="font-display text-4xl font-black">
                Vidura
              </CardTitle>
              <CardDescription>Sign in to save your lessons.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <Field data-invalid={Boolean(error)}>
              <FieldLabel>Google account</FieldLabel>
              <FieldDescription className="font-bold text-foreground/60">
                Continue with Google to save your video library and chats.
              </FieldDescription>
              {error ? (
                <FieldDescription className="font-bold text-destructive">
                  {error}
                </FieldDescription>
              ) : null}
            </Field>
            <CartoonButton disabled={submitting} onClick={handleSignIn} type="button">
              <span className="grid size-6 place-items-center rounded-full border-2 border-foreground bg-card font-black">
                G
              </span>
              {submitting ? "Opening Google..." : "Continue with Google"}
              <ChevronRightIcon data-icon="inline-end" />
            </CartoonButton>
          </div>
        </CardContent>
      </StickerCard>
    </main>
  );
}

function TopBar() {
  const auth = useAuth();
  const location = useLocation();
  const selectedVideoId = useAppStore((state) => state.selectedVideoId);
  const currentView = viewFromPath(location.pathname);
  const title = {
    library: "Library",
    add: "Add video",
    watch: "Watch",
    chat: "Chat",
    settings: "Settings",
  }[currentView];

  return (
    <header className="mb-4 flex items-center justify-between gap-3 sm:mb-5 lg:hidden">
      <div className="min-w-0">
        <p className="truncate font-display text-3xl font-black leading-none tracking-normal">
          {title}
        </p>
        <p className="truncate text-sm font-medium text-foreground/55">
          Learn better, one video at a time.
        </p>
      </div>
      {currentView === "chat" ? (
        <ChatSessionsSheet
          trigger={
            <Button
              className="vidura-icon-button ml-auto shrink-0"
              size="icon-lg"
              variant="outline"
            >
              <HistoryIcon />
              <span className="sr-only">Chat history</span>
            </Button>
          }
        />
      ) : null}
      <Sheet>
        <SheetTrigger asChild>
          <Button className="vidura-icon-button shrink-0" size="icon-lg" variant="outline">
            <MenuIcon />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          className="flex w-[min(100vw-1.5rem,18rem)] flex-col border-2 border-foreground bg-background p-0 sm:max-w-xs"
          side="left"
        >
          <SheetHeader className="border-b-2 border-foreground px-4 py-4">
            <div className="flex items-center gap-2.5 pr-8">
              <div className="grid size-11 place-items-center rounded-lg border-2 border-foreground bg-vidura-sun shadow-[3px_3px_0_var(--vidura-ink)]">
                <BookOpenIcon />
              </div>
              <div className="min-w-0">
                <SheetTitle className="truncate font-display text-3xl font-black">
                  Vidura
                </SheetTitle>
                <SheetDescription className="truncate font-semibold text-foreground/55">
                  Your playful Sinhala study companion.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-4">
            {navItems.map(({ view, label, Icon }) => (
              <Button
                asChild
                className={cn(
                  "h-10 justify-start rounded-md border-2 border-transparent px-2 text-sm font-black",
                  currentView === view &&
                  "border-foreground bg-vidura-mint text-foreground shadow-[3px_3px_0_var(--vidura-ink)] hover:bg-vidura-mint"
                )}
                key={view}
                variant={currentView === view ? "secondary" : "ghost"}
              >
                <NavLink to={navPathFor(view, selectedVideoId)}>
                  <Icon data-icon="inline-start" />
                  {label}
                </NavLink>
              </Button>
            ))}
          </div>
          {auth.configured && auth.user ? (
            <SheetFooter className="border-t-2 border-foreground bg-card/60 px-4 py-4">
              <SidebarProfileFooter onSignOut={auth.signOut} user={auth.user} />
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    </header>
  );
}

function getUserDisplayName(user: User | null) {
  if (!user) {
    return "Guest";
  }

  const metadata = user.user_metadata;

  if (typeof metadata?.full_name === "string" && metadata.full_name.trim()) {
    return metadata.full_name.trim();
  }

  if (typeof metadata?.name === "string" && metadata.name.trim()) {
    return metadata.name.trim();
  }

  return user.email?.split("@")[0] ?? "User";
}

function getUserInitials(user: User | null) {
  const displayName = getUserDisplayName(user);
  const parts = displayName.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }

  return displayName.slice(0, 2).toUpperCase();
}

function SidebarProfileFooter({
  user,
  onSignOut,
  className,
}: {
  user: User | null;
  onSignOut: () => Promise<void>;
  className?: string;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const displayName = getUserDisplayName(user);
  const email = user?.email ?? "Signed in";

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-center gap-2.5 rounded-lg border-2 border-foreground bg-card p-2.5 shadow-[3px_3px_0_var(--vidura-ink)]">
        <Avatar className="size-9 shrink-0 border-2 border-foreground bg-vidura-purple">
          <AvatarFallback className="bg-transparent text-xs font-black text-foreground">
            {getUserInitials(user)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black leading-tight">{displayName}</p>
          <p className="truncate text-[0.68rem] font-semibold text-foreground/55">
            {email}
          </p>
        </div>
      </div>
      <Button
        className="h-9 w-full justify-start rounded-md border-2 border-foreground bg-card px-2.5 text-sm font-bold shadow-[2px_2px_0_var(--vidura-ink)] hover:bg-vidura-coral/15"
        disabled={signingOut}
        onClick={() => {
          void handleSignOut();
        }}
        size="sm"
        variant="outline"
      >
        <LogOutIcon data-icon="inline-start" />
        {signingOut ? "Signing out..." : "Sign out"}
      </Button>
    </div>
  );
}

function DesktopSidebar() {
  const auth = useAuth();
  const location = useLocation();
  const selectedVideoId = useAppStore((state) => state.selectedVideoId);
  const currentView = viewFromPath(location.pathname);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[216px] shrink-0 border-r-2 border-foreground bg-background lg:block 2xl:w-[224px]">
      <div className="flex h-full flex-col px-4 py-5">
        <div className="shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid size-12 place-items-center rounded-lg border-2 border-foreground bg-vidura-sun shadow-[3px_3px_0_var(--vidura-ink)]">
              <BookOpenIcon />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-3xl font-black leading-none tracking-normal">
                Vidura
              </h1>
              <p className="truncate text-[0.72rem] font-semibold text-foreground/55">
                Sinhala video study
              </p>
            </div>
          </div>
        </div>
        <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto py-1">
          {navItems.map(({ view, label, Icon }) => (
            <Button
              asChild
              className={cn(
                "h-9 justify-start rounded-md border-2 border-transparent px-2 text-sm font-black",
                currentView === view &&
                "border-foreground bg-vidura-mint text-foreground shadow-[3px_3px_0_var(--vidura-ink)] hover:bg-vidura-mint"
              )}
              key={view}
              variant={currentView === view ? "secondary" : "ghost"}
            >
              <NavLink to={navPathFor(view, selectedVideoId)}>
                <Icon data-icon="inline-start" />
                {label}
              </NavLink>
            </Button>
          ))}
        </nav>
        <div className="mt-auto flex shrink-0 flex-col gap-4 pt-4">
          <div className="rounded-lg border-2 border-foreground bg-card p-3 shadow-[3px_3px_0_var(--vidura-ink)]">
            <div className="mb-2 flex items-center gap-2">
              <div className="grid size-8 place-items-center rounded-md border-2 border-foreground bg-vidura-sun">
                <BadgeCheckIcon />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black leading-none">Level 3</p>
                <p className="text-[0.68rem] font-bold text-foreground/55">
                  Study sync
                </p>
              </div>
            </div>
            <p className="text-xs font-semibold leading-snug text-foreground/65">
              Library updates live from Supabase.
            </p>
          </div>
          {auth.configured && auth.user ? (
            <>
              <Separator className="bg-foreground/15" />
              <SidebarProfileFooter onSignOut={auth.signOut} user={auth.user} />
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function MobileNav() {
  const location = useLocation();
  const selectedVideoId = useAppStore((state) => state.selectedVideoId);
  const currentView = viewFromPath(location.pathname);

  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 rounded-lg border-2 border-foreground bg-card px-2 py-1.5 shadow-[4px_4px_0_var(--vidura-ink)] sm:inset-x-4 sm:bottom-4 sm:px-2.5 lg:hidden">
      <div className="grid grid-cols-5 gap-1 sm:gap-1.5">
        {navItems.map(({ view, label, Icon }) => (
          <Button
            asChild
            className={cn(
              "h-12 flex-col gap-0.5 rounded-md px-1 text-[0.66rem] font-bold sm:h-13 sm:text-[0.7rem]",
              currentView === view &&
              "border-2 border-foreground bg-vidura-mint text-foreground hover:bg-vidura-mint"
            )}
            key={view}
            variant="ghost"
          >
            <NavLink className="flex flex-col items-center justify-center" to={navPathFor(view, selectedVideoId)}>
              <Icon className="size-4 sm:size-4.5" data-icon="inline-start" />
              <span className="truncate">{label}</span>
            </NavLink>
          </Button>
        ))}
      </div>
    </nav>
  );
}

function LibraryScreen({
  videos,
  isPending,
  error,
}: {
  videos: LibraryVideo[];
  isPending: boolean;
  error: Error | null;
}) {
  const [category, setCategory] = useState("All");
  const selectVideo = useAppStore((state) => state.selectVideo);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteVideoMutation = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });
    },
  });
  const filteredVideos = useMemo(
    () =>
      category === "All"
        ? videos
        : videos.filter((video) => video.category === category),
    [category, videos]
  );
  const categoryOptions = useMemo(
    () => ["All", ...Array.from(new Set(videos.map((video) => video.category)))],
    [videos],
  );
  const learningStats = useMemo(
    () => [
      { label: "Videos processed", value: videos.length.toString() },
      {
        label: "Ready",
        value: videos.filter((video) => video.status === "ready").length.toString(),
      },
      {
        label: "Processing",
        value: videos.filter((video) => video.status !== "ready").length.toString(),
      },
    ],
    [videos],
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="hidden items-end justify-between gap-4 lg:flex">
        <div>
          <h2 className="font-display text-5xl font-black tracking-normal">
            Library
          </h2>
          <p className="text-base font-medium text-foreground/60">
            Pick up where your translated lessons stopped.
          </p>
        </div>
        <SearchTools />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          className="justify-start overflow-x-auto"
          onValueChange={(value) => value && setCategory(value)}
          type="single"
          value={category}
        >
          {categoryOptions.map((item) => (
            <ToggleGroupItem
              className="rounded-md border-2 border-foreground bg-card data-[state=on]:bg-vidura-mint"
              key={item}
              value={item}
            >
              {item}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="lg:hidden">
          <SearchTools compact />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          {isPending ? (
            <StickerCard>
              <CardContent className="p-4 font-black">Loading videos...</CardContent>
            </StickerCard>
          ) : null}
          {error ? (
            <StickerCard className="bg-vidura-coral">
              <CardContent className="p-4 font-black">
                Could not load library: {error.message}
              </CardContent>
            </StickerCard>
          ) : null}
          {!isPending && !error && filteredVideos.length === 0 ? (
            <StickerCard>
              <CardContent className="p-5">
                <h3 className="font-display text-3xl font-black">No videos yet</h3>
                <p className="mt-1 text-sm font-semibold text-foreground/60">
                  Add a YouTube link to start your first Sinhala study session.
                </p>
              </CardContent>
            </StickerCard>
          ) : null}
          {filteredVideos.map((video) => (
            <StickerCard
              className="cursor-pointer transition-transform hover:-translate-y-0.5"
              key={video.id}
              onClick={() => {
                selectVideo(video.id);
                navigate(`/watch/${video.id}`);
              }}
            >
              <CardContent className="grid gap-3 p-3 sm:grid-cols-[164px_1fr_auto] sm:items-center">
                <div
                  className={cn(
                    "relative flex aspect-video items-center justify-center overflow-hidden rounded-md border-2 border-foreground text-foreground",
                    video.accent
                  )}
                >
                  {video.thumbnailUrl ? (
                    <img
                      alt=""
                      className="size-full object-cover"
                      src={video.thumbnailUrl}
                    />
                  ) : (
                    <video.Icon className="size-12" />
                  )}
                  <Badge className="absolute bottom-2 right-2 border border-foreground bg-card text-foreground">
                    {video.duration}
                  </Badge>
                </div>
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-black leading-tight sm:text-lg">
                        {video.title}
                      </h3>
                      <p className="mt-1 text-sm font-medium text-foreground/60">
                        {video.channel}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          onClick={(event) => event.stopPropagation()}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <MoreHorizontalIcon />
                          <span className="sr-only">Open video menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onClick={() => {
                              selectVideo(video.id);
                              navigate(`/watch/${video.id}`);
                            }}
                          >
                            Open video
                          </DropdownMenuItem>
                          <DropdownMenuItem>Download subtitles</DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteVideoMutation.mutate(video.id)}
                          >
                            Delete video
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-foreground/65">
                    <Badge variant="secondary">{video.category}</Badge>
                    {isVideoStillProcessing(video) ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-foreground bg-vidura-sun px-2 py-1 text-foreground">
                        <Loader2Icon className="size-3.5 animate-spin" />
                        {video.latestJob?.status ?? video.status}
                      </span>
                    ) : (
                      <span>{video.latestJob?.status ?? video.status}</span>
                    )}
                    <span>
                      {(video.latestJob?.metadata.stage as string | undefined) ??
                        "created"}
                    </span>
                  </div>
                </div>
                <Badge
                  className={cn(
                    "w-fit border-2 border-foreground",
                    video.status === "ready"
                      ? "bg-vidura-mint text-foreground"
                      : "bg-vidura-sun text-foreground"
                  )}
                >
                  {isVideoStillProcessing(video) ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      {video.progress}
                    </span>
                  ) : (
                    video.progress
                  )}
                </Badge>
              </CardContent>
            </StickerCard>
          ))}
        </div>
        <aside className="flex flex-col gap-4">
          <StickerPanel title="Keep learning">
            <div className="grid grid-cols-3 gap-2 xl:grid-cols-1">
              {learningStats.map((stat) => (
                <div
                  className="rounded-md border-2 border-foreground bg-vidura-cream p-3"
                  key={stat.label}
                >
                  <p className="font-display text-2xl font-black">
                    {stat.value}
                  </p>
                  <p className="text-xs font-bold text-foreground/60">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </StickerPanel>
          <MascotBubble tone="sky">
            Add a difficult video, translate it once, and keep asking questions
            as you study.
          </MascotBubble>
        </aside>
      </div>
    </section>
  );
}

function SearchTools({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <InputGroup className={cn("border-2 border-foreground bg-card", compact && "h-10")}>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search videos..." />
      </InputGroup>
      <Button className="vidura-icon-button" size="icon-lg" variant="outline">
        <FilterIcon />
        <span className="sr-only">Filter videos</span>
      </Button>
    </div>
  );
}

function AddVideoScreen() {
  const transcriptInputRef = useRef<HTMLInputElement>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState("");
  const [transcriptFileName, setTranscriptFileName] = useState("");
  const [transcriptSegments, setTranscriptSegmentsState] = useState<
    TranscriptSegment[]
  >([]);
  const [transcriptError, setTranscriptError] = useState("");
  const setSelectedVideoId = useAppStore((state) => state.setSelectedVideoId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleStartProcessing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedUrl = parseYouTubeUrl(youtubeUrl);

    if (!parsedUrl) {
      setUrlError("Paste a valid YouTube video, Shorts, embed, or youtu.be link.");
      return;
    }

    setIsSubmitting(true);
    setSubmitStep("Preparing video...");

    try {
      let segmentsForJob = transcriptSegments;
      let devMetadata: {
        title?: string;
        channelTitle?: string;
        thumbnailUrl?: string;
      } = {};

      if (import.meta.env.DEV && segmentsForJob.length === 0) {
        setSubmitStep("Fetching transcript locally...");
        const videoData = await fetchDevYouTubeVideoData(parsedUrl.videoId);
        segmentsForJob = videoData.segments;
        devMetadata = videoData.metadata;
      }

      if (import.meta.env.DEV && segmentsForJob.length === 0) {
        throw new Error("No transcript segments were found for this video.");
      }

      setSubmitStep("Creating processing job...");
      const response = await createVideoJob({
        youtubeUrl: parsedUrl.canonicalUrl,
        title: devMetadata.title,
        channelTitle: devMetadata.channelTitle,
        thumbnailUrl: devMetadata.thumbnailUrl,
        targetLanguage: "si-LK",
        segments: segmentsForJob,
      });

      setSelectedVideoId(response.video.id);
      await queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });

      setUrlError("");
      navigate(`/processing/${response.video.id}`);
    } catch (createError) {
      setUrlError(
        createError instanceof Error
          ? createError.message
          : "Could not create the video job.",
      );
    } finally {
      setIsSubmitting(false);
      setSubmitStep("");
    }
  }

  async function handleTranscriptFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsedTranscript = await parseTranscriptFile(file);

      if (parsedTranscript.length === 0) {
        throw new Error("No transcript lines were found in that file.");
      }

      setTranscriptSegmentsState(parsedTranscript);
      setTranscriptFileName(file.name);
      setTranscriptError("");
    } catch (parseError) {
      setTranscriptSegmentsState([]);
      setTranscriptFileName("");
      setTranscriptError(
        parseError instanceof Error
          ? parseError.message
          : "Could not read that transcript file.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setYoutubeUrl(text);
      setUrlError("");
    } catch {
      setUrlError("Clipboard access was not available. Paste the link manually.");
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_360px]">
      <StickerPanel
        description="Paste a YouTube link. If captions are missing, import a transcript file."
        title="Add video"
      >
        <form onSubmit={handleStartProcessing}>
          <FieldGroup>
            <Field data-invalid={Boolean(urlError)}>
              <FieldLabel htmlFor="youtube-url">YouTube link</FieldLabel>
              <InputGroup className="h-12 border-2 border-foreground bg-card">
                <InputGroupInput
                  aria-invalid={Boolean(urlError)}
                  id="youtube-url"
                  onChange={(event) => {
                    setYoutubeUrl(event.target.value);
                    if (urlError) {
                      setUrlError("");
                    }
                  }}
                  placeholder="Paste YouTube URL here..."
                  value={youtubeUrl}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton onClick={pasteFromClipboard} size="icon-sm">
                    <LinkIcon />
                    <span className="sr-only">Paste link</span>
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {urlError ? (
                <FieldDescription className="font-bold text-destructive">
                  {urlError}
                </FieldDescription>
              ) : (
                <FieldDescription>
                  Supports `youtube.com/watch`, `youtu.be`, Shorts, and embed
                  links.
                </FieldDescription>
              )}
            </Field>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs font-black uppercase text-foreground/50">
                or
              </span>
              <Separator className="flex-1" />
            </div>
            <Field>
              <FieldLabel>Import transcript optional</FieldLabel>
              <div className="rounded-lg border-2 border-dashed border-foreground bg-vidura-cream p-5 text-center">
                <UploadIcon className="mx-auto mb-3 size-8" />
                <FieldTitle className="mx-auto">
                  Drop `.srt`, `.vtt`, or `.txt`
                </FieldTitle>
                <FieldDescription className="mx-auto max-w-sm text-center">
                  {transcriptSegments.length > 0
                    ? `Loaded ${transcriptSegments.length} lines from ${transcriptFileName}.`
                    : "Manual transcripts keep the workflow available when a video has no public captions."}
                </FieldDescription>
                <input
                  accept=".srt,.vtt,.txt"
                  className="sr-only"
                  onChange={handleTranscriptFileChange}
                  ref={transcriptInputRef}
                  type="file"
                />
                <Button
                  className="mt-4 border-2 border-foreground"
                  onClick={() => transcriptInputRef.current?.click()}
                  type="button"
                  variant="outline"
                >
                  {transcriptSegments.length > 0 ? "Replace file" : "Choose file"}
                </Button>
              </div>
              {transcriptError ? (
                <FieldDescription className="font-bold text-destructive">
                  {transcriptError}
                </FieldDescription>
              ) : null}
            </Field>
            <MascotBubble tone="sun">
              We will fetch the transcript if available, translate it to Sinhala,
              and generate synced subtitles.
            </MascotBubble>
            <CartoonButton disabled={isSubmitting} type="submit">
              {isSubmitting ? submitStep || "Creating job..." : "Start processing"}
              <ChevronRightIcon data-icon="inline-end" />
            </CartoonButton>
          </FieldGroup>
        </form>
      </StickerPanel>

      <div className="flex flex-col gap-4">
        <StickerPanel title="How it works">
          <div className="flex flex-col gap-3">
            {[
              "Fetch or import transcript",
              "Translate with context",
              "Sync Sinhala subtitles",
              "Save to your library",
            ].map((item, index) => (
              <div className="flex items-center gap-3" key={item}>
                <div className="grid size-8 place-items-center rounded-md border-2 border-foreground bg-vidura-mint font-black">
                  {index + 1}
                </div>
                <p className="font-bold">{item}</p>
              </div>
            ))}
          </div>
        </StickerPanel>
        <StickerPanel title="Connection">
          <Badge
            className={cn(
              "w-fit border-2 border-foreground",
              hasSupabaseConfig ? "bg-vidura-mint" : "bg-vidura-sun"
            )}
          >
            {hasSupabaseConfig ? "Supabase configured" : "Local mock mode"}
          </Badge>
          <p className="mt-3 text-sm font-medium text-foreground/65">
            The UI is ready for Supabase Auth and Edge Functions. Add env vars
            when backend wiring starts.
          </p>
        </StickerPanel>
      </div>
    </section>
  );
}

function ProcessingRoute() {
  const { videoId } = useParams();
  const navigate = useNavigate();

  return (
    <ProcessingScreen
      onOpenWatch={() => navigate(videoId ? `/watch/${videoId}` : "/watch")}
      videoId={videoId ?? null}
    />
  );
}

function ProcessingScreen({
  onOpenWatch,
  videoId,
}: {
  onOpenWatch: () => void;
  videoId: string | null;
}) {
  const videosQuery = useLibraryVideos(Boolean(videoId));
  const video = videosQuery.data?.find((item) => item.id === videoId) ?? null;
  const job = video?.latestJob ?? null;
  const stage = typeof job?.metadata.stage === "string"
    ? job.metadata.stage
    : job?.status ?? "queued";
  const totalSegments = Number(job?.metadata.total_segments ?? 0);
  const translatedSegments = Number(job?.metadata.translated_segments ?? 0);
  const currentSegmentText =
    typeof job?.metadata.current_segment_text === "string"
      ? job.metadata.current_segment_text
      : null;

  return (
    <section className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_340px]">
      <StickerPanel
        description={video?.title ?? "Waiting for the new video job"}
        title="Processing"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full border-2 border-foreground bg-vidura-sun font-black">
                {job?.status === "ready" ? <CheckIcon /> : <ClockIcon />}
              </div>
              <div className="flex-1">
                <p className="font-black">{titleCase(stage.replaceAll("_", " "))}</p>
                <Progress
                  className="mt-2 h-3 border border-foreground"
                  value={job?.progress ?? 0}
                />
              </div>
              <Badge className="border-2 border-foreground bg-vidura-sun text-foreground">
                {job?.progress ?? 0}%
              </Badge>
            </div>
            {totalSegments > 0 ? (
              <StickerCard className="bg-vidura-cream">
                <CardContent className="p-4">
                  <p className="font-black">
                    Translating {translatedSegments} of {totalSegments} segments
                  </p>
                  {currentSegmentText ? (
                    <p className="mt-2 text-sm font-semibold text-foreground/65">
                      Current: {currentSegmentText}
                    </p>
                  ) : null}
                </CardContent>
              </StickerCard>
            ) : null}
            {job?.errorMessage ? (
              <StickerCard className="bg-vidura-coral">
                <CardContent className="p-4 text-sm font-black">
                  {job.errorMessage}
                </CardContent>
              </StickerCard>
            ) : null}
          </div>
          <StickerCard className="bg-vidura-sky">
            <CardContent className="flex items-center gap-3 p-4">
              <BellIcon className="size-8" />
              <p className="text-sm font-bold">
                You will get a notification when it is ready.
              </p>
            </CardContent>
          </StickerCard>
          <CartoonButton onClick={onOpenWatch}>
            Open watch screen
            <CirclePlayIcon data-icon="inline-end" />
          </CartoonButton>
          <Button asChild className="border-2 border-foreground" variant="outline">
            <NavLink to="/library">
              Send to background
              <HomeIcon data-icon="inline-end" />
            </NavLink>
          </Button>
        </div>
      </StickerPanel>
      <MascotBubble tone="mint">
        Long videos will run as background jobs so mobile users can leave this
        screen and come back later.
      </MascotBubble>
    </section>
  );
}

function SubtitleCaption({
  activeSubtitle,
  subtitlesStillLoading,
  subtitleOpacity,
  subtitleSize,
  variant,
}: {
  activeSubtitle: TranscriptSegment | null;
  subtitlesStillLoading: boolean;
  subtitleOpacity: number;
  subtitleSize: number;
  variant: SubtitlePlacement;
}) {
  const content = activeSubtitle?.sinhala ? (
    activeSubtitle.sinhala
  ) : subtitlesStillLoading ? (
    <span className="inline-flex items-center justify-center gap-2">
      <Loader2Icon className="size-4 shrink-0 animate-spin" />
      Sinhala subtitles are loading...
    </span>
  ) : (
    "Subtitles will appear when the video reaches a translated line."
  );

  if (variant === "overlay") {
    return (
      <div
        className="pointer-events-none absolute inset-x-3 bottom-3 z-10 mx-auto max-w-[min(88%,720px)] rounded-md border-2 border-white px-2.5 py-1.5 text-center font-black leading-tight text-white shadow-[4px_4px_0_#000] sm:bottom-5 sm:px-3 sm:py-2 sm:leading-snug"
        style={{
          backgroundColor: `rgb(17 24 39 / ${subtitleOpacity / 100})`,
          display: "-webkit-box",
          fontSize: `clamp(14px, 3.4vw, ${subtitleSize}px)`,
          maxHeight: "4.8em",
          overflow: "hidden",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
        }}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className="rounded-md border-2 border-foreground bg-card px-3 py-2.5 text-center font-black leading-snug text-foreground shadow-[3px_3px_0_var(--vidura-ink)]"
      style={{
        fontSize: `clamp(14px, 3.4vw, ${subtitleSize}px)`,
      }}
    >
      {content}
    </div>
  );
}

function WatchScreen({ videos }: { videos: LibraryVideo[] }) {
  const subtitleEnabled = useAppStore((state) => state.subtitleEnabled);
  const subtitlePlacement = useAppStore((state) => state.subtitlePlacement);
  const subtitleSize = useAppStore((state) => state.subtitleSize);
  const subtitleOpacity = useAppStore((state) => state.subtitleOpacity);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const [isImmersive, setIsImmersive] = useState(false);
  const [playbackTime, setPlaybackTime] = useState<{
    videoId: string | null;
    milliseconds: number;
  }>({ videoId: null, milliseconds: 0 });
  const { videoId } = useParams();
  const navigate = useNavigate();
  const storedSelectedVideoId = useAppStore((state) => state.selectedVideoId);
  const setSelectedVideoId = useAppStore((state) => state.setSelectedVideoId);
  const selectedVideoId = videoId ?? storedSelectedVideoId;
  const selectedVideo =
    videos.find((video) => video.id === selectedVideoId) ?? videos[0] ?? null;
  const transcriptQuery = useQuery({
    queryKey: videoQueryKeys.transcript(selectedVideo?.id ?? null),
    queryFn: () => fetchVideoTranscript(selectedVideo?.id ?? null),
    enabled: Boolean(selectedVideo),
    // Fallback only — realtime pushes transcript updates as they land.
    refetchInterval: isVideoStillProcessing(selectedVideo) ? 5_000 : false,
  });
  const selectedTranscript = transcriptQuery.data ?? [];
  const subtitlesStillLoading = transcriptQuery.isPending ||
    transcriptQuery.isFetching ||
    isVideoStillProcessing(selectedVideo);
  const showOverlaySubtitles = isImmersive || subtitlePlacement === "overlay";
  const showBelowSubtitles = !isImmersive && subtitlePlacement === "below";
  const currentPlaybackMs = playbackTime.videoId === selectedVideo?.id
    ? playbackTime.milliseconds
    : 0;
  const activeSubtitle = findActiveTranscriptSegment(
    selectedTranscript,
    currentPlaybackMs,
  );
  const youtubeVideoId = isYouTubeVideoId(selectedVideo?.youtubeVideoId)
    ? selectedVideo.youtubeVideoId
    : null;
  const videoWatchUrl = selectedVideo?.youtubeUrl ??
    (youtubeVideoId ? buildYouTubeWatchUrl(youtubeVideoId) : null);
  const playbackMsRef = useRef(0);
  const getCurrentTimeMs = useCallback(() => playbackMsRef.current, []);
  const handlePlaybackTimeChange = useCallback((milliseconds: number) => {
    playbackMsRef.current = milliseconds;
    setPlaybackTime((currentTime) => {
      if (
        currentTime.videoId === selectedVideo?.id &&
        Math.abs(currentTime.milliseconds - milliseconds) < 250
      ) {
        return currentTime;
      }

      return {
        videoId: selectedVideo?.id ?? null,
        milliseconds,
      };
    });
  }, [selectedVideo?.id]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsImmersive(document.fullscreenElement === videoContainerRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  async function toggleImmersivePlayback() {
    const container = videoContainerRef.current;

    if (!container) {
      return;
    }

    if (isImmersive) {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }

      setIsImmersive(false);
      return;
    }

    try {
      await container.requestFullscreen();
      setIsImmersive(true);
    } catch {
      setIsImmersive(true);
    }
  }

  useEffect(() => {
    if (selectedVideo?.id && selectedVideo.id !== storedSelectedVideoId) {
      setSelectedVideoId(selectedVideo.id);
    }
  }, [selectedVideo?.id, setSelectedVideoId, storedSelectedVideoId]);

  if (!selectedVideo) {
    return (
      <StickerCard>
        <CardContent className="p-5">
          <h2 className="font-display text-3xl font-black">No video selected</h2>
          <p className="mt-1 text-sm font-semibold text-foreground/60">
            Add a video or open one from the library.
          </p>
        </CardContent>
      </StickerCard>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="hidden items-center justify-between gap-3 lg:flex">
          <div>
            <h2 className="font-display text-4xl font-black tracking-normal">
              Watch
            </h2>
            <p className="font-medium text-foreground/60">
              {selectedVideo.title}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button className="border-2 border-foreground" variant="outline">
              <DownloadIcon data-icon="inline-start" />
              Subtitles
            </Button>
            <Button
              className="border-2 border-foreground bg-vidura-mint text-foreground"
              onClick={() => navigate("/settings")}
              variant="secondary"
            >
              <SettingsIcon data-icon="inline-start" />
              SI subtitles
            </Button>
          </div>
        </div>
        <div className="overflow-visible rounded-lg border-2 border-foreground bg-vidura-ink shadow-[5px_5px_0_var(--vidura-shadow)]">
          <div
            className={cn(
              "relative bg-vidura-ink",
              isImmersive
                ? "fixed inset-0 z-50 flex h-dvh w-dvw items-center justify-center bg-black"
                : "aspect-video rounded-lg",
            )}
            ref={videoContainerRef}
          >
            {youtubeVideoId ? (
              <YouTubePlayerFrame
                key={youtubeVideoId}
                onTimeChange={handlePlaybackTimeChange}
                title={selectedVideo.title}
                videoId={youtubeVideoId}
                watchUrl={videoWatchUrl}
              />
            ) : (
              <>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,#8b7cf6_0_9%,transparent_10%),radial-gradient(circle_at_70%_35%,#ffcf4a_0_5%,transparent_6%),radial-gradient(circle_at_50%_75%,#4ecdc4_0_7%,transparent_8%)]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="grid size-28 place-items-center rounded-full border-2 border-white bg-vidura-purple text-white shadow-[6px_6px_0_#ff6b5a] sm:size-40">
                    <CirclePlayIcon className="size-16 sm:size-24" />
                  </div>
                </div>
              </>
            )}
            {youtubeVideoId ? (
              <Button
                aria-label={isImmersive ? "Exit fullscreen" : "Enter fullscreen"}
                className="pointer-events-auto absolute top-2 right-2 z-20 border-2 border-white/80 bg-black/55 text-white hover:bg-black/75 lg:hidden"
                onClick={() => {
                  void toggleImmersivePlayback();
                }}
                size="icon-sm"
                variant="ghost"
              >
                {isImmersive ? <Minimize2Icon /> : <Maximize2Icon />}
              </Button>
            ) : null}
            {subtitleEnabled && showOverlaySubtitles ? (
              <SubtitleCaption
                activeSubtitle={activeSubtitle}
                subtitleOpacity={subtitleOpacity}
                subtitleSize={subtitleSize}
                subtitlesStillLoading={subtitlesStillLoading}
                variant="overlay"
              />
            ) : null}
            {!youtubeVideoId ? (
              <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 text-white">
                <CirclePlayIcon className="size-5" />
                <div className="h-2 flex-1 rounded-full bg-white/25">
                  <div className="h-2 w-[32%] rounded-full bg-vidura-coral" />
                </div>
                <span className="text-xs font-black">4:12 / 22:47</span>
              </div>
            ) : null}
          </div>
        </div>
        {subtitleEnabled && showBelowSubtitles ? (
          <SubtitleCaption
            activeSubtitle={activeSubtitle}
            subtitleOpacity={subtitleOpacity}
            subtitleSize={subtitleSize}
            subtitlesStillLoading={subtitlesStillLoading}
            variant="below"
          />
        ) : null}
        <div className="grid gap-4 xl:hidden">
          <TranscriptPanel
            activeSegmentId={activeSubtitle?.id ?? null}
            isProcessing={isVideoStillProcessing(selectedVideo)}
            videoId={selectedVideo.id}
          />
          <NotesPanel
            getCurrentTimeMs={getCurrentTimeMs}
            videoId={selectedVideo.id}
          />
        </div>
        <div className="hidden flex-col gap-4 xl:flex">
          <TranscriptPanel
            activeSegmentId={activeSubtitle?.id ?? null}
            isProcessing={isVideoStillProcessing(selectedVideo)}
            videoId={selectedVideo.id}
          />
          <NotesPanel
            getCurrentTimeMs={getCurrentTimeMs}
            videoId={selectedVideo.id}
          />
        </div>
      </div>
      <aside className="hidden min-h-0 flex-col gap-4 xl:flex">
        <ChatPanel videoId={selectedVideo.id} />
        <VideoInfoPanel video={selectedVideo} />
      </aside>
      <FloatingChatButton videoId={selectedVideo.id} />
    </section>
  );
}

function findActiveTranscriptSegment(
  segments: TranscriptSegment[],
  playbackMs: number,
) {
  if (segments.length === 0) {
    return null;
  }

  const activeSegment = segments.find(
    (segment) => {
      if (!hasSegmentTiming(segment)) {
        return false;
      }

      return playbackMs >= segment.startMs - 500 &&
        playbackMs < segment.endMs + 250;
    },
  );

  if (activeSegment) {
    return activeSegment;
  }

  const firstTimedSegment = segments.find(hasSegmentTiming);

  if (!firstTimedSegment || playbackMs < firstTimedSegment.startMs) {
    return null;
  }

  return null;
}

function hasSegmentTiming(
  segment: TranscriptSegment,
): segment is TranscriptSegment & { startMs: number; endMs: number } {
  return typeof segment.startMs === "number" &&
    typeof segment.endMs === "number";
}

function YouTubePlayerFrame({
  onTimeChange,
  title,
  videoId,
  watchUrl,
}: {
  onTimeChange: (milliseconds: number) => void;
  title: string;
  videoId: string;
  watchUrl: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const onTimeChangeRef = useRef(onTimeChange);
  const lastReportedTimeRef = useRef(-1);
  const [playerError, setPlayerError] = useState<number | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isTouchPlayback, setIsTouchPlayback] = useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    onTimeChangeRef.current = onTimeChange;
  }, [onTimeChange]);

  useEffect(() => {
    function updateTouchPlayback() {
      setIsTouchPlayback(
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(max-width: 1023px)").matches,
      );
    }

    updateTouchPlayback();
    window.addEventListener("resize", updateTouchPlayback);

    return () => {
      window.removeEventListener("resize", updateTouchPlayback);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeInterval: ReturnType<typeof window.setInterval> | null = null;
    const startTimePolling = () => {
      if (timeInterval) {
        return;
      }

      timeInterval = window.setInterval(() => {
        const player = playerRef.current;

        if (!player || typeof player.getCurrentTime !== "function") {
          return;
        }

        const playerState = typeof player.getPlayerState === "function"
          ? player.getPlayerState()
          : null;

        if (playerState === 1 || playerState === 3) {
          setHasStartedPlayback(true);
          setIsPlaying(true);
        } else if (playerState === 2 || playerState === 0 || playerState === 5) {
          setIsPlaying(false);
        }

        const currentTime = player.getCurrentTime();

        if (typeof currentTime !== "number" || Number.isNaN(currentTime)) {
          return;
        }

        const milliseconds = Math.max(0, Math.floor(currentTime * 1000));

        if (Math.abs(milliseconds - lastReportedTimeRef.current) < 250) {
          return;
        }

        lastReportedTimeRef.current = milliseconds;
        onTimeChangeRef.current(milliseconds);
      }, 250);
    };

    setPlayerError(null);
    setIsPlayerReady(false);
    setHasStartedPlayback(false);
    setIsPlaying(false);

    void loadYouTubeIframeApi()
      .then(() => {
        if (cancelled || !containerRef.current || !window.YT?.Player) {
          return;
        }

        playerRef.current?.destroy();
        playerRef.current = new window.YT.Player(containerRef.current, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            controls: 1,
            enablejsapi: 1,
            fs: 1,
            modestbranding: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              if (cancelled) {
                return;
              }

              setIsPlayerReady(true);
              startTimePolling();
            },
            onStateChange: (event) => {
              if (event.data === 1 || event.data === 3) {
                setHasStartedPlayback(true);
                setIsPlaying(true);
              } else if (event.data === 2 || event.data === 0 || event.data === 5) {
                setIsPlaying(false);
              }
            },
            onError: (event) => {
              if ([2, 5, 100, 101, 150].includes(event.data)) {
                setPlayerError(event.data);
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerError(0);
        }
      });

    return () => {
      cancelled = true;
      if (timeInterval) {
        window.clearInterval(timeInterval);
      }
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  function handleTogglePlayback() {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    const playerState = typeof player.getPlayerState === "function"
      ? player.getPlayerState()
      : -1;

    if (playerState === 1 || playerState === 3) {
      if (typeof player.pauseVideo === "function") {
        player.pauseVideo();
      }

      setIsPlaying(false);
      return;
    }

    if (typeof player.playVideo === "function") {
      player.playVideo();
    }

    setHasStartedPlayback(true);
    setIsPlaying(true);
  }

  const showCenterPlay = isTouchPlayback && isPlayerReady && !playerError &&
    !hasStartedPlayback;
  const showMobilePlaybackControl = isTouchPlayback && isPlayerReady && !playerError &&
    hasStartedPlayback;

  return (
    <>
      <div
        aria-label={title}
        className={cn(
          "absolute inset-0 z-0 size-full touch-manipulation [&_iframe]:pointer-events-auto [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:size-full [&_iframe]:h-full [&_iframe]:w-full [&>div]:absolute [&>div]:inset-0 [&>div]:size-full",
          playerError ? "pointer-events-none opacity-0" : null,
        )}
        ref={containerRef}
      />
      {showCenterPlay ? (
        <button
          aria-label="Play video"
          className="absolute inset-0 z-10 flex touch-manipulation items-center justify-center bg-black/25"
          onClick={handleTogglePlayback}
          type="button"
        >
          <span className="grid size-20 place-items-center rounded-full border-2 border-white/90 bg-black/45 text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <CirclePlayIcon className="ml-1 size-10" />
          </span>
        </button>
      ) : null}
      {showMobilePlaybackControl ? (
        <button
          aria-label={isPlaying ? "Pause video" : "Play video"}
          className="pointer-events-auto absolute bottom-3 left-3 z-30 grid size-12 place-items-center rounded-full border-2 border-white/90 bg-black/60 text-white shadow-[0_6px_18px_rgba(0,0,0,0.45)] touch-manipulation"
          onClick={handleTogglePlayback}
          type="button"
        >
          {isPlaying ? (
            <PauseIcon className="size-6" />
          ) : (
            <CirclePlayIcon className="ml-0.5 size-6" />
          )}
        </button>
      ) : null}
      {playerError ? (
        <div className="absolute inset-0 grid place-items-center bg-vidura-ink p-6 text-center text-white">
          <div className="max-w-sm">
            <div className="mx-auto grid size-16 place-items-center rounded-full border-2 border-white/70 text-white/80">
              <CirclePlayIcon className="size-8" />
            </div>
            <h3 className="mt-4 text-2xl font-black">Playback blocked here</h3>
            <p className="mt-2 text-sm font-bold text-white/70">
              This video can only be watched on YouTube.
            </p>
            <Button
              asChild
              className="mt-5 border-2 border-white bg-vidura-sun text-foreground hover:bg-vidura-sun/90"
            >
              <a href={watchUrl ?? buildYouTubeWatchUrl(videoId)} rel="noreferrer" target="_blank">
                <LinkIcon data-icon="inline-start" />
                Open on YouTube
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

// Memoized: WatchScreen re-renders 4x/second while the player reports playback
// time; these panels only depend on videoId/activeSegmentId and must not
// re-render with it.
const TranscriptPanel = memo(function TranscriptPanel({
  activeSegmentId,
  isProcessing = false,
  videoId,
}: {
  activeSegmentId?: string | null;
  isProcessing?: boolean;
  videoId: string;
}) {
  const queryClient = useQueryClient();
  const collapsed = useAppStore((state) => state.transcriptCollapsed);
  const setCollapsed = useAppStore((state) => state.setTranscriptCollapsed);
  const transcriptQuery = useQuery({
    queryKey: videoQueryKeys.transcript(videoId),
    queryFn: () => fetchVideoTranscript(videoId),
    // Fallback only — realtime pushes transcript updates as they land.
    refetchInterval: isProcessing ? 5_000 : false,
  });
  const invalidateAfterRegenerate = async () => {
    await queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });
    await queryClient.invalidateQueries({
      queryKey: videoQueryKeys.transcript(videoId),
    });
  };
  const regenerateMutation = useMutation({
    mutationFn: () =>
      regenerateSubtitles({
        videoId,
        rebuildContext: true,
      }),
    onSuccess: invalidateAfterRegenerate,
  });
  const regenerateTranscriptMutation = useMutation({
    mutationFn: () =>
      regenerateSubtitles({
        videoId,
        rebuildContext: true,
        regenerateTranscript: true,
      }),
    onSuccess: invalidateAfterRegenerate,
  });
  const selectedTranscript = transcriptQuery.data ?? [];
  const isLoading = transcriptQuery.isPending || transcriptQuery.isFetching;
  const isRegenerating = regenerateMutation.isPending ||
    regenerateTranscriptMutation.isPending || isProcessing;
  const regenerateError = regenerateMutation.error ??
    regenerateTranscriptMutation.error;

  return (
    <StickerCard>
      <Tabs defaultValue="sinhala">
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <button
                aria-expanded={!collapsed}
                className="flex items-center gap-2 text-left"
                onClick={() => setCollapsed(!collapsed)}
                type="button"
              >
                <CardTitle className="font-display text-2xl font-black">
                  Transcript
                </CardTitle>
                <ChevronDownIcon
                  className={cn(
                    "size-5 shrink-0 transition-transform",
                    collapsed && "-rotate-90",
                  )}
                />
              </button>
              {!collapsed ? (
                <TabsList className="border-2 border-foreground bg-vidura-cream">
                  <TabsTrigger value="sinhala">Sinhala</TabsTrigger>
                  <TabsTrigger value="bilingual">Bilingual</TabsTrigger>
                </TabsList>
              ) : null}
            </div>
            {collapsed ? null : (
            <div className="flex flex-col gap-2 sm:flex-row sm:self-start">
              <Button
                className="w-full border-2 border-foreground sm:w-auto"
                disabled={isRegenerating || selectedTranscript.length === 0}
                onClick={() => {
                  regenerateMutation.mutate();
                }}
                size="sm"
                variant="outline"
              >
                {regenerateMutation.isPending ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                Regenerate subtitles
              </Button>
              <Button
                className="w-full border-2 border-foreground sm:w-auto"
                disabled={isRegenerating}
                onClick={() => {
                  regenerateTranscriptMutation.mutate();
                }}
                size="sm"
                variant="outline"
              >
                {regenerateTranscriptMutation.isPending ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ListVideoIcon data-icon="inline-start" />
                )}
                Regenerate transcript
              </Button>
            </div>
            )}
          </div>
          {regenerateError ? (
            <p className="mt-2 text-sm font-semibold text-vidura-coral">
              {regenerateError instanceof Error
                ? regenerateError.message
                : "Could not start regeneration."}
            </p>
          ) : null}
          {(isLoading || isRegenerating) && !collapsed ? (
            <div className="mt-3">
              <InlineLoadingNotice
                label={
                  regenerateTranscriptMutation.isPending
                    ? "Refetching the transcript and rebuilding subtitles..."
                    : regenerateMutation.isPending
                    ? "Rebuilding Sinhala subtitles with full video context..."
                    : isLoading
                    ? "Loading Sinhala subtitles..."
                    : "Translating more subtitle lines..."
                }
              />
            </div>
          ) : null}
        </CardHeader>
        {collapsed ? null : (
        <CardContent>
          {!isLoading && !isRegenerating && selectedTranscript.length === 0 ? (
            <p className="text-sm font-black text-foreground/60">
              Transcript lines will appear here as processing stores them.
            </p>
          ) : null}
          <TabsContent className="mt-0" value="sinhala">
            <TranscriptRows
              activeSegmentId={activeSegmentId}
              isLoading={isLoading || isRegenerating}
              mode="sinhala"
              segments={selectedTranscript}
            />
          </TabsContent>
          <TabsContent className="mt-0" value="bilingual">
            <TranscriptRows
              activeSegmentId={activeSegmentId}
              isLoading={isLoading || isRegenerating}
              mode="bilingual"
              segments={selectedTranscript}
            />
          </TabsContent>
        </CardContent>
        )}
      </Tabs>
    </StickerCard>
  );
});

const TranscriptRows = memo(function TranscriptRows({
  activeSegmentId,
  isLoading = false,
  mode,
  segments,
}: {
  activeSegmentId?: string | null;
  isLoading?: boolean;
  mode: "sinhala" | "bilingual";
  segments: TranscriptSegment[];
}) {
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeSegmentId]);

  return (
    <ScrollArea className="h-[260px] pr-3">
      <div className="flex flex-col gap-2">
        {segments.length === 0 && isLoading ? (
          <div className="rounded-md border-2 border-dashed border-foreground bg-vidura-cream p-4">
            <InlineLoadingNotice label="Waiting for the first translated lines..." />
          </div>
        ) : null}
        {segments.map((segment) => (
          <button
            className={cn(
              "grid grid-cols-[56px_1fr] gap-3 rounded-md border-2 border-foreground bg-card p-3 text-left shadow-[2px_2px_0_var(--vidura-ink)]",
              segment.id === activeSegmentId && "bg-vidura-mint"
            )}
            key={segment.id}
            ref={segment.id === activeSegmentId ? activeRowRef : null}
            type="button"
          >
            <Badge className="border border-foreground bg-vidura-sun text-foreground">
              {segment.time}
            </Badge>
            <span className="text-sm font-semibold leading-relaxed">
              {mode === "bilingual" ? (
                <>
                  <span>{segment.original}</span>
                  <span className="mt-1 block text-foreground/65">
                    {segment.sinhala}
                  </span>
                </>
              ) : (
                segment.sinhala
              )}
            </span>
          </button>
        ))}
        {segments.length > 0 && isLoading ? (
          <div className="rounded-md border-2 border-dashed border-foreground bg-vidura-cream p-3">
            <InlineLoadingNotice label="More subtitles are on the way..." />
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
});

// Timestamped study notes. Notes are stored per video and indexed so the
// chat assistant can retrieve them alongside the transcript.
const NotesPanel = memo(function NotesPanel({
  videoId,
  getCurrentTimeMs,
}: {
  videoId: string;
  getCurrentTimeMs: () => number;
}) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const notesQuery = useQuery({
    queryKey: videoQueryKeys.notes(videoId),
    queryFn: () => fetchVideoNotes(videoId),
  });
  const invalidateNotes = () =>
    queryClient.invalidateQueries({ queryKey: videoQueryKeys.notes(videoId) });
  const addNoteMutation = useMutation({
    mutationFn: addVideoNote,
    onSuccess: invalidateNotes,
  });
  const deleteNoteMutation = useMutation({
    mutationFn: deleteVideoNote,
    onSuccess: invalidateNotes,
  });
  const notes = notesQuery.data ?? [];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();

    if (!content || addNoteMutation.isPending) {
      return;
    }

    addNoteMutation.mutate({
      videoId,
      timestampMs: getCurrentTimeMs(),
      content,
    });
    setDraft("");
  }

  return (
    <StickerCard>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="font-display text-2xl font-black">
              Notes
            </CardTitle>
            <CardDescription>
              Saved at the current playback time.
            </CardDescription>
          </div>
          <NotebookPenIcon className="size-6 shrink-0" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={handleSubmit}>
          <InputGroup className="h-auto border-2 border-foreground bg-card">
            <InputGroupTextarea
              className="min-h-12"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Write a note about this moment..."
              value={draft}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                className="bg-vidura-mint text-foreground"
                disabled={!draft.trim() || addNoteMutation.isPending}
                size="icon-sm"
                type="submit"
              >
                {addNoteMutation.isPending ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <PlusIcon />
                )}
                <span className="sr-only">Add note</span>
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
        {addNoteMutation.isError ? (
          <p className="text-sm font-semibold text-vidura-coral">
            {addNoteMutation.error instanceof Error
              ? addNoteMutation.error.message
              : "Could not save the note."}
          </p>
        ) : null}
        {notes.length === 0 && !notesQuery.isPending ? (
          <p className="text-sm font-bold text-foreground/60">
            No notes yet. Pause at an important moment and jot one down.
          </p>
        ) : null}
        {notes.length > 0 ? (
          <div className="flex max-h-[220px] flex-col gap-2 overflow-y-auto pr-2">
            {notes.map((note) => (
              <div
                className="grid grid-cols-[56px_1fr_auto] items-start gap-3 rounded-md border-2 border-foreground bg-card p-3 shadow-[2px_2px_0_var(--vidura-ink)]"
                key={note.id}
              >
                <Badge className="border border-foreground bg-vidura-sun text-foreground">
                  {formatNoteTimestamp(note.timestampMs)}
                </Badge>
                <p className="whitespace-pre-wrap text-sm font-semibold leading-relaxed">
                  {note.content}
                </p>
                <Button
                  aria-label="Delete note"
                  disabled={deleteNoteMutation.isPending}
                  onClick={() => deleteNoteMutation.mutate(note.id)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </StickerCard>
  );
});

function formatNoteTimestamp(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${
    seconds.toString().padStart(2, "0")
  }`;
}

type ChatPanelVariant = "panel" | "overlay" | "page";

const libraryQuickPrompts = [
  "What videos do I have?",
  "Summarize my latest video",
  "What did I note down recently?",
];

// videoId null = the library-wide assistant that can answer across every
// video in the library with title + timestamp citations. threadId selects a
// saved library session; when null the server opens a fresh session on the
// first message and reports it through onThreadCreated.
const ChatPanel = memo(function ChatPanel({
  videoId,
  threadId = null,
  onThreadCreated,
  variant = "panel",
}: {
  videoId: string | null;
  threadId?: string | null;
  onThreadCreated?: (threadId: string) => void;
  variant?: ChatPanelVariant;
}) {
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [chatError, setChatError] = useState("");
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chatQuery = useQuery({
    queryKey: videoId
      ? videoQueryKeys.chat(videoId)
      : chatSessionKeys.messages(threadId),
    queryFn: () =>
      videoId
        ? fetchChatMessages(videoId)
        : threadId
        ? fetchSessionMessages(threadId)
        : Promise.resolve([]),
    enabled: Boolean(videoId || threadId),
  });
  const messages = chatQuery.data ?? [];
  const isStreaming = pendingQuestion !== null;
  const isThinking = isStreaming && streamingAnswer.length === 0;
  const isLoadingHistory = chatQuery.isPending && Boolean(videoId || threadId);

  useEffect(() => {
    const container = scrollRef.current;

    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length, streamingAnswer, pendingQuestion]);

  async function askQuestion(question: string) {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion || isStreaming) {
      return;
    }

    setDraft("");
    setChatError("");
    setPendingQuestion(trimmedQuestion);
    setStreamingAnswer("");

    let createdThreadId: string | null = null;

    try {
      await streamVideoChat({
        videoId,
        threadId,
        question: trimmedQuestion,
        onDelta: (text) => setStreamingAnswer((current) => current + text),
        onThreadId: (id) => {
          createdThreadId = id;
        },
      });

      if (videoId) {
        await queryClient.invalidateQueries({
          queryKey: videoQueryKeys.chat(videoId),
        });
      } else {
        const finalThreadId = threadId ?? createdThreadId;

        if (finalThreadId) {
          // Warm the cache before the route switches to the new session so
          // the conversation never flashes a loading state.
          await queryClient.prefetchQuery({
            queryKey: chatSessionKeys.messages(finalThreadId),
            queryFn: () => fetchSessionMessages(finalThreadId),
          });
          await queryClient.invalidateQueries({
            queryKey: chatSessionKeys.messages(finalThreadId),
          });
          void queryClient.invalidateQueries({
            queryKey: chatSessionKeys.list,
            exact: true,
          });
        }
      }
    } catch (streamError) {
      setChatError(
        streamError instanceof Error
          ? streamError.message
          : "Could not get an answer. Try again.",
      );
    } finally {
      if (createdThreadId && !threadId && !videoId) {
        onThreadCreated?.(createdThreadId);
      }

      setPendingQuestion(null);
      setStreamingAnswer("");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askQuestion(draft);
  }

  const emptyNotice = videoId
    ? "Ask anything about this video — answers cite the exact timestamps."
    : "Ask anything about your library — answers name the video and timestamp.";
  const prompts = videoId ? quickPrompts.slice(0, 3) : libraryQuickPrompts;
  const showPrompts = variant === "page"
    ? messages.length === 0 && !isStreaming && !isLoadingHistory
    : true;
  const scrollHeightClass = variant === "panel"
    ? "h-[230px]"
    : "min-h-0 flex-1";

  const body = (
    <>
      {showPrompts ? (
        <div className="flex flex-wrap gap-2">
          {prompts.map((prompt) => (
            <Button
              className="h-auto rounded-md border-2 border-foreground bg-vidura-cream px-3 py-2 text-xs"
              disabled={isStreaming}
              key={prompt}
              onClick={() => void askQuestion(prompt)}
              type="button"
              variant="outline"
            >
              {prompt}
            </Button>
          ))}
        </div>
      ) : null}
      <div
        className={cn("overflow-y-auto pr-2", scrollHeightClass)}
        ref={scrollRef}
      >
        <div className="flex flex-col gap-3">
          {isLoadingHistory ? (
            <div className="rounded-lg border-2 border-dashed border-foreground bg-vidura-cream p-3 text-sm font-bold leading-relaxed text-foreground/65">
              Loading chat...
            </div>
          ) : null}
          {!isLoadingHistory && messages.length === 0 && !isStreaming ? (
            <div className="rounded-lg border-2 border-dashed border-foreground bg-vidura-cream p-3 text-sm font-bold leading-relaxed text-foreground/65">
              {emptyNotice}
            </div>
          ) : null}
          {messages.map((message) => (
            <ChatBubble
              content={message.content}
              key={message.id}
              role={message.role}
            />
          ))}
          {pendingQuestion ? (
            <ChatBubble content={pendingQuestion} role="user" />
          ) : null}
          {isThinking ? (
            <div className="flex max-w-[88%] items-center gap-2 rounded-lg border-2 border-foreground bg-card p-3 text-sm font-bold text-foreground/65 shadow-[2px_2px_0_var(--vidura-ink)]">
              <Loader2Icon className="size-4 shrink-0 animate-spin" />
              Thinking...
            </div>
          ) : null}
          {isStreaming && streamingAnswer ? (
            <ChatBubble content={streamingAnswer} role="assistant" streaming />
          ) : null}
          {chatError ? (
            <div className="rounded-lg border-2 border-foreground bg-vidura-coral/25 p-3 text-sm font-bold text-foreground">
              {chatError}
            </div>
          ) : null}
        </div>
      </div>
      <form className="shrink-0" onSubmit={handleSubmit}>
        <InputGroup className="h-auto border-2 border-foreground bg-card">
          <InputGroupTextarea
            className="min-h-16"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void askQuestion(draft);
              }
            }}
            placeholder={
              videoId ? "Ask about this video..." : "Ask about any video..."
            }
            value={draft}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              className="bg-vidura-purple text-foreground"
              disabled={!draft.trim() || isStreaming}
              size="icon-sm"
              type="submit"
            >
              {isStreaming ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <SendIcon />
              )}
              <span className="sr-only">Send message</span>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </>
  );

  // The page variant renders flat (no card chrome): messages fill the page
  // and the input stays pinned above the bottom navigation.
  if (variant === "page") {
    return <div className="flex min-h-0 flex-1 flex-col gap-3">{body}</div>;
  }

  return (
    <StickerCard
      className={cn(
        variant === "overlay"
          ? "flex min-h-0 flex-1 flex-col border-0 shadow-none"
          : "min-h-[360px]",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="font-display text-2xl font-black">
              Chat
            </CardTitle>
            <CardDescription>Ask about this video.</CardDescription>
          </div>
          <Avatar className="border-2 border-foreground bg-vidura-purple">
            <AvatarFallback className="bg-transparent font-black text-foreground">
              AI
            </AvatarFallback>
          </Avatar>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "flex flex-col gap-3",
          variant === "overlay" && "min-h-0 flex-1",
        )}
      >
        {body}
      </CardContent>
    </StickerCard>
  );
});

function ChatBubble({
  content,
  role,
  streaming = false,
}: {
  content: string;
  role: "user" | "assistant";
  streaming?: boolean;
}) {
  return (
    <div
      className={cn(
        "max-w-[88%] rounded-lg border-2 border-foreground p-3 text-sm font-medium leading-relaxed shadow-[2px_2px_0_var(--vidura-ink)]",
        role === "user"
          ? "ml-auto whitespace-pre-wrap bg-vidura-purple"
          : "bg-card",
      )}
    >
      {role === "assistant" ? (
        <div className="chat-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        content
      )}
      {streaming ? (
        <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-foreground/70 align-text-bottom" />
      ) : null}
    </div>
  );
}

// Chat session history: pick a previous library chat to continue, rename it,
// or delete it. Rendered from the mobile top bar and the desktop chat header.
function ChatSessionsSheet({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const activeThreadId = location.pathname.startsWith("/chats/session/")
    ? location.pathname.split("/")[3] ?? null
    : null;
  const sessionsQuery = useQuery({
    queryKey: chatSessionKeys.list,
    queryFn: fetchChatSessions,
    enabled: open,
  });
  const invalidateSessions = () =>
    queryClient.invalidateQueries({ queryKey: chatSessionKeys.list, exact: true });
  const renameMutation = useMutation({
    mutationFn: renameChatSession,
    onSuccess: invalidateSessions,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteChatSession,
    onSuccess: (_, deletedThreadId) => {
      void invalidateSessions();

      if (deletedThreadId === activeThreadId) {
        navigate("/chats");
      }
    },
  });
  const sessions = sessionsQuery.data ?? [];

  function openSession(threadId: string) {
    setOpen(false);
    navigate(`/chats/session/${threadId}`);
  }

  function submitRename(threadId: string) {
    const title = renameDraft.trim();

    if (title) {
      renameMutation.mutate({ threadId, title });
    }

    setRenamingId(null);
    setRenameDraft("");
  }

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        className="flex w-[min(100vw-1.5rem,20rem)] flex-col border-2 border-foreground bg-background p-0"
        side="right"
      >
        <SheetHeader className="border-b-2 border-foreground px-4 py-4">
          <SheetTitle className="font-display text-2xl font-black">
            Chat history
          </SheetTitle>
          <SheetDescription className="font-semibold text-foreground/55">
            Continue, rename, or delete a session.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
          <Button
            className="justify-start border-2 border-foreground bg-vidura-mint"
            onClick={() => {
              setOpen(false);
              navigate("/chats");
            }}
            variant="secondary"
          >
            <SquarePenIcon data-icon="inline-start" />
            New chat
          </Button>
          {sessionsQuery.isPending ? (
            <InlineLoadingNotice label="Loading sessions..." />
          ) : null}
          {!sessionsQuery.isPending && sessions.length === 0 ? (
            <p className="px-1 text-sm font-bold text-foreground/60">
              No saved chats yet. Start one and it will appear here.
            </p>
          ) : null}
          {sessions.map((session) => (
            <div
              className={cn(
                "flex items-center gap-1 rounded-md border-2 border-foreground bg-card p-2 shadow-[2px_2px_0_var(--vidura-ink)]",
                session.id === activeThreadId && "bg-vidura-mint",
              )}
              key={session.id}
            >
              {renamingId === session.id ? (
                <>
                  <InputGroup className="h-9 flex-1 border-2 border-foreground bg-background">
                    <InputGroupInput
                      autoFocus
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitRename(session.id);
                        }

                        if (event.key === "Escape") {
                          setRenamingId(null);
                        }
                      }}
                      value={renameDraft}
                    />
                  </InputGroup>
                  <Button
                    aria-label="Save name"
                    onClick={() => submitRename(session.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <CheckIcon className="size-4" />
                  </Button>
                  <Button
                    aria-label="Cancel rename"
                    onClick={() => setRenamingId(null)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <XIcon className="size-4" />
                  </Button>
                </>
              ) : (
                <>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openSession(session.id)}
                    type="button"
                  >
                    <p className="truncate text-sm font-black leading-tight">
                      {session.title}
                    </p>
                    <p className="text-[0.68rem] font-semibold text-foreground/55">
                      {new Date(session.updatedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </button>
                  <Button
                    aria-label="Rename chat"
                    onClick={() => {
                      setRenamingId(session.id);
                      setRenameDraft(session.title);
                    }}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    aria-label="Delete chat"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(session.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Floating chat launcher for mobile — opens the per-video chat as a
// bottom-sheet overlay so the conversation gets the whole screen.
function FloatingChatButton({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button
          aria-label="Chat about this video"
          className="fixed bottom-24 right-4 z-40 size-14 rounded-full border-2 border-foreground bg-vidura-purple text-foreground shadow-[4px_4px_0_var(--vidura-ink)] hover:bg-vidura-purple xl:hidden"
          size="icon-lg"
        >
          <MessageCircleIcon className="size-6" />
        </Button>
      </SheetTrigger>
      <SheetContent
        className="flex h-[88dvh] flex-col gap-0 rounded-t-xl border-2 border-foreground bg-background p-0"
        side="bottom"
      >
        <SheetHeader className="border-b-2 border-foreground px-4 py-3">
          <SheetTitle className="font-display text-2xl font-black">
            Video chat
          </SheetTitle>
          <SheetDescription className="sr-only">
            Chat about the current video
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
          <ChatPanel variant="overlay" videoId={videoId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChatScreen() {
  // /chats always starts a fresh session; /chats/session/:threadId resumes a
  // saved one from the history sheet.
  const { threadId } = useParams();
  const navigate = useNavigate();

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 pb-2 lg:pb-4">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="hidden lg:block">
          <h2 className="font-display text-4xl font-black tracking-normal">
            Library chat
          </h2>
          <p className="font-medium text-foreground/60">
            Ask across all your videos — answers cite titles and timestamps.
          </p>
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          <Button
            className="border-2 border-foreground"
            onClick={() => navigate("/chats")}
            size="sm"
            variant="outline"
          >
            <SquarePenIcon data-icon="inline-start" />
            New chat
          </Button>
          <span className="hidden lg:inline-flex">
            <ChatSessionsSheet
              trigger={
                <Button
                  className="border-2 border-foreground"
                  size="sm"
                  variant="outline"
                >
                  <HistoryIcon data-icon="inline-start" />
                  History
                </Button>
              }
            />
          </span>
        </div>
      </div>
      <ChatPanel
        key={threadId ?? "new"}
        onThreadCreated={(createdThreadId) =>
          navigate(`/chats/session/${createdThreadId}`, { replace: true })}
        threadId={threadId ?? null}
        variant="page"
        videoId={null}
      />
    </section>
  );
}

function VideoInfoPanel({ video }: { video: LibraryVideo }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deleteVideoMutation = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });
      navigate("/library");
    },
  });
  const videoUrl =
    video.youtubeUrl ??
    (isYouTubeVideoId(video.youtubeVideoId)
      ? buildYouTubeWatchUrl(video.youtubeVideoId)
      : null);

  async function shareVideo() {
    if (!videoUrl) {
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: video.title,
          url: videoUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(videoUrl);
    } catch {
      // Sharing can be cancelled by the user or blocked by browser permissions.
    }
  }

  function openVideo() {
    if (!videoUrl) {
      return;
    }

    window.open(videoUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <StickerPanel title="Video info">
      <div className="flex gap-3">
        <div
          className={cn(
            "grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border-2 border-foreground",
            video.accent
          )}
        >
          {video.thumbnailUrl ? (
            <img alt="" className="size-full object-cover" src={video.thumbnailUrl} />
          ) : (
            <video.Icon className="size-9" />
          )}
        </div>
        <div>
          <p className="font-black leading-tight">{video.title}</p>
          <p className="mt-1 text-xs font-semibold text-foreground/60">
            {video.channel}
          </p>
        </div>
      </div>
      <Separator className="my-4" />
      <div className="flex flex-col gap-2">
        <Button className="justify-start border-2 border-foreground" variant="outline">
          <ListVideoIcon data-icon="inline-start" />
          Add to watch later
        </Button>
        <Button
          className="justify-start border-2 border-foreground"
          disabled={!videoUrl}
          onClick={() => void shareVideo()}
          variant="outline"
        >
          <ListVideoIcon data-icon="inline-start" />
          Share video
        </Button>
        <Button
          className="justify-start border-2 border-foreground"
          disabled={!videoUrl}
          onClick={openVideo}
          variant="outline"
        >
          <ListVideoIcon data-icon="inline-start" />
          Open in YouTube
        </Button>
        <Button
          className="justify-start border-2 border-foreground"
          disabled={deleteVideoMutation.isPending}
          onClick={() => deleteVideoMutation.mutate(video.id)}
          variant="outline"
        >
          <Trash2Icon data-icon="inline-start" />
          Delete video
        </Button>
      </div>
    </StickerPanel>
  );
}

function SettingsScreen() {
  const subtitleEnabled = useAppStore((state) => state.subtitleEnabled);
  const subtitlePlacement = useAppStore((state) => state.subtitlePlacement);
  const subtitleSize = useAppStore((state) => state.subtitleSize);
  const subtitleOpacity = useAppStore((state) => state.subtitleOpacity);
  const setSubtitleEnabled = useAppStore((state) => state.setSubtitleEnabled);
  const setSubtitlePlacement = useAppStore((state) => state.setSubtitlePlacement);
  const setSubtitleSize = useAppStore((state) => state.setSubtitleSize);
  const setSubtitleOpacity = useAppStore((state) => state.setSubtitleOpacity);

  return (
    <section className="mx-auto max-w-3xl">
      <StickerPanel
        description="Tune subtitle readability for mobile and desktop playback."
        title="Settings"
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <div className="flex-1">
              <FieldLabel>SI subtitles</FieldLabel>
              <FieldDescription>Show translated Sinhala captions.</FieldDescription>
            </div>
            <Switch
              checked={subtitleEnabled}
              onCheckedChange={setSubtitleEnabled}
            />
          </Field>
          <FieldSet>
            <FieldTitle>Subtitle placement</FieldTitle>
            <FieldDescription>
              Keep captions below the video on mobile, or overlay them on the
              player when you want a theater-style view. Fullscreen mode always
              overlays subtitles so landscape playback stays readable.
            </FieldDescription>
            <ToggleGroup
              className="justify-start"
              onValueChange={(value) => {
                if (value === "overlay" || value === "below") {
                  setSubtitlePlacement(value);
                }
              }}
              type="single"
              value={subtitlePlacement}
            >
              <ToggleGroupItem
                className="rounded-md border-2 border-foreground bg-card data-[state=on]:bg-vidura-mint"
                value="below"
              >
                Below video
              </ToggleGroupItem>
              <ToggleGroupItem
                className="rounded-md border-2 border-foreground bg-card data-[state=on]:bg-vidura-mint"
                value="overlay"
              >
                Overlay on video
              </ToggleGroupItem>
            </ToggleGroup>
          </FieldSet>
          <Field>
            <FieldLabel>Language</FieldLabel>
            <Select defaultValue="si">
              <SelectTrigger className="h-11 border-2 border-foreground bg-card">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <FieldSet>
            <FieldTitle>Subtitle size</FieldTitle>
            <div className="flex items-center gap-3">
              <Badge className="border-2 border-foreground bg-card text-foreground">
                A-
              </Badge>
              <Slider
                max={28}
                min={16}
                onValueChange={([value]) => setSubtitleSize(value)}
                step={1}
                value={[subtitleSize]}
              />
              <Badge className="border-2 border-foreground bg-card text-foreground">
                A+
              </Badge>
            </div>
          </FieldSet>
          <FieldSet>
            <FieldTitle>Background opacity</FieldTitle>
            <div className="flex items-center gap-3">
              <Slider
                max={100}
                min={35}
                onValueChange={([value]) => setSubtitleOpacity(value)}
                step={1}
                value={[subtitleOpacity]}
              />
              <Badge className="border-2 border-foreground bg-vidura-sun text-foreground">
                {subtitleOpacity}%
              </Badge>
            </div>
          </FieldSet>
          <Field>
            <FieldLabel>Study notes</FieldLabel>
            <Textarea
              className="min-h-28 border-2 border-foreground bg-card"
              placeholder="Add personal notes for this lesson..."
            />
          </Field>
        </FieldGroup>
      </StickerPanel>
    </section>
  );
}

export default App;
