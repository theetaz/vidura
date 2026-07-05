import { useMemo, useState } from "react";
import {
  BadgeCheckIcon,
  BellIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  CirclePlayIcon,
  DownloadIcon,
  FilterIcon,
  HomeIcon,
  LinkIcon,
  ListVideoIcon,
  MenuIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  UploadIcon,
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
import {
  categories,
  chatMessages,
  languageOptions,
  learningStats,
  processingSteps,
  quickPrompts,
  transcript,
  videos,
} from "@/features/videos/data";
import { hasSupabaseConfig } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAppStore, type AppView } from "@/stores/app-store";
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
}> = [
  { view: "library", label: "Library", Icon: HomeIcon },
  { view: "add", label: "Add", Icon: PlusIcon },
  { view: "watch", label: "Watch", Icon: CirclePlayIcon },
  { view: "chat", label: "Chats", Icon: MessageCircleIcon },
  { view: "settings", label: "Settings", Icon: SettingsIcon },
];

function App() {
  return (
    <TooltipProvider>
      <ViduraApp />
    </TooltipProvider>
  );
}

function ViduraApp() {
  const currentView = useAppStore((state) => state.currentView);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1760px] flex-col lg:flex-row">
        <DesktopSidebar />
        <main className="min-w-0 flex-1 px-4 pb-36 pt-4 sm:px-6 lg:px-6 lg:pb-7 xl:px-7">
          <TopBar />
          {currentView === "library" ? <LibraryScreen /> : null}
          {currentView === "add" ? <AddVideoScreen /> : null}
          {currentView === "watch" ? <WatchScreen /> : null}
          {currentView === "chat" ? <ChatScreen standalone /> : null}
          {currentView === "settings" ? <SettingsScreen /> : null}
        </main>
        <MobileNav />
      </div>
    </div>
  );
}

function TopBar() {
  const currentView = useAppStore((state) => state.currentView);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const title = {
    library: "Library",
    add: "Add video",
    watch: "Watch",
    chat: "Chat",
    settings: "Settings",
  }[currentView];

  return (
    <header className="mb-4 flex items-center justify-between gap-3 lg:hidden">
      <div>
        <p className="font-display text-3xl font-black leading-none tracking-normal">
          {title}
        </p>
        <p className="text-sm font-medium text-foreground/55">
          Learn better, one video at a time.
        </p>
      </div>
      <Sheet>
        <SheetTrigger asChild>
          <Button className="vidura-icon-button" size="icon-lg" variant="outline">
            <MenuIcon />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent className="border-2 border-foreground bg-background" side="left">
          <SheetHeader>
            <SheetTitle className="font-display text-3xl font-black">
              Vidura
            </SheetTitle>
            <SheetDescription>
              Your playful Sinhala study companion.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4">
            {navItems.map(({ view, label, Icon }) => (
              <Button
                className="justify-start"
                key={view}
                onClick={() => setCurrentView(view)}
                variant={currentView === view ? "default" : "ghost"}
              >
                <Icon data-icon="inline-start" />
                {label}
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

function DesktopSidebar() {
  const currentView = useAppStore((state) => state.currentView);
  const setCurrentView = useAppStore((state) => state.setCurrentView);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[216px] shrink-0 border-r-2 border-foreground bg-background px-4 py-5 lg:block 2xl:w-[224px]">
      <div className="flex h-full flex-col gap-5">
        <div>
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
        <nav className="flex flex-col gap-1.5">
          {navItems.map(({ view, label, Icon }) => (
            <Button
              className={cn(
                "h-9 justify-start rounded-md border-2 border-transparent px-2 text-sm font-black",
                currentView === view &&
                  "border-foreground bg-vidura-mint text-foreground shadow-[3px_3px_0_var(--vidura-ink)] hover:bg-vidura-mint"
              )}
              key={view}
              onClick={() => setCurrentView(view)}
              variant={currentView === view ? "secondary" : "ghost"}
            >
              <Icon data-icon="inline-start" />
              {label}
            </Button>
          ))}
        </nav>
        <div className="rounded-lg border-2 border-foreground bg-card p-3 shadow-[3px_3px_0_var(--vidura-ink)]">
          <div className="mb-2 flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-md border-2 border-foreground bg-vidura-sun">
              <BadgeCheckIcon />
            </div>
            <div>
              <p className="text-sm font-black leading-none">Level 3</p>
              <p className="text-[0.68rem] font-bold text-foreground/55">
                Study pulse
              </p>
            </div>
          </div>
          <Progress className="h-2 border border-foreground" value={64} />
          <p className="mt-2 text-xs font-semibold leading-snug text-foreground/65">
            3 videos processed this week.
          </p>
        </div>
      </div>
    </aside>
  );
}

function MobileNav() {
  const currentView = useAppStore((state) => state.currentView);
  const setCurrentView = useAppStore((state) => state.setCurrentView);

  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 rounded-lg border-2 border-foreground bg-card px-2 py-1.5 shadow-[4px_4px_0_var(--vidura-ink)] lg:hidden">
      <div className="grid grid-cols-5 gap-1">
        {navItems.map(({ view, label, Icon }) => (
          <Button
            className={cn(
              "h-12 flex-col gap-0.5 rounded-md px-1 text-[0.66rem] font-bold",
              currentView === view &&
                "border-2 border-foreground bg-vidura-mint text-foreground hover:bg-vidura-mint"
            )}
            key={view}
            onClick={() => setCurrentView(view)}
            variant="ghost"
          >
            <Icon data-icon="inline-start" />
            {label}
          </Button>
        ))}
      </div>
    </nav>
  );
}

function LibraryScreen() {
  const [category, setCategory] = useState("All");
  const selectVideo = useAppStore((state) => state.selectVideo);
  const filteredVideos = useMemo(
    () =>
      category === "All"
        ? videos
        : videos.filter((video) => video.category === category),
    [category]
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
          {categories.map((item) => (
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
          {filteredVideos.map((video) => (
            <StickerCard
              className="cursor-pointer transition-transform hover:-translate-y-0.5"
              key={video.id}
              onClick={() => selectVideo(video.id)}
            >
              <CardContent className="grid gap-3 p-3 sm:grid-cols-[164px_1fr_auto] sm:items-center">
                <div
                  className={cn(
                    "relative flex aspect-video items-center justify-center overflow-hidden rounded-md border-2 border-foreground text-foreground",
                    video.accent
                  )}
                >
                  <video.Icon className="size-12" />
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
                          <DropdownMenuItem>Open video</DropdownMenuItem>
                          <DropdownMenuItem>Download subtitles</DropdownMenuItem>
                          <DropdownMenuItem>Add to watch later</DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-foreground/65">
                    <Badge variant="secondary">{video.category}</Badge>
                    <span>EN</span>
                    <span>SI subtitles</span>
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
                  {video.progress}
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
  const [isProcessing, setIsProcessing] = useState(false);
  const setCurrentView = useAppStore((state) => state.setCurrentView);

  if (isProcessing) {
    return <ProcessingScreen onOpenWatch={() => setCurrentView("watch")} />;
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_360px]">
      <StickerPanel
        description="Paste a YouTube link. If captions are missing, import a transcript file."
        title="Add video"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="youtube-url">YouTube link</FieldLabel>
            <InputGroup className="h-12 border-2 border-foreground bg-card">
              <InputGroupInput
                id="youtube-url"
                placeholder="Paste YouTube URL here..."
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-sm">
                  <LinkIcon />
                  <span className="sr-only">Paste link</span>
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
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
              <FieldTitle className="mx-auto">Drop `.srt`, `.vtt`, or `.txt`</FieldTitle>
              <FieldDescription className="mx-auto max-w-sm text-center">
                Manual transcripts keep the workflow available when a video has
                no public captions.
              </FieldDescription>
              <Button className="mt-4 border-2 border-foreground" variant="outline">
                Choose file
              </Button>
            </div>
          </Field>
          <MascotBubble tone="sun">
            We will fetch the transcript if available, translate it to Sinhala,
            and generate synced subtitles.
          </MascotBubble>
          <CartoonButton onClick={() => setIsProcessing(true)}>
            Start processing
            <ChevronRightIcon data-icon="inline-end" />
          </CartoonButton>
        </FieldGroup>
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

function ProcessingScreen({ onOpenWatch }: { onOpenWatch: () => void }) {
  return (
    <section className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_340px]">
      <StickerPanel
        description="Quantum Physics Explained - Simply and Visually"
        title="Processing"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            {processingSteps.map((step, index) => (
              <div className="flex items-center gap-3" key={step.label}>
                <div
                  className={cn(
                    "grid size-10 place-items-center rounded-full border-2 border-foreground font-black",
                    step.state === "complete" && "bg-vidura-mint",
                    step.state === "active" && "bg-vidura-sun",
                    step.state === "pending" && "bg-card"
                  )}
                >
                  {step.state === "complete" ? <CheckIcon /> : index + 1}
                </div>
                <div className="flex-1">
                  <p className="font-black">{step.label}</p>
                  {step.state === "active" ? (
                    <Progress className="mt-2 h-3 border border-foreground" value={72} />
                  ) : null}
                </div>
                {step.state === "active" ? (
                  <Badge className="border-2 border-foreground bg-vidura-sun text-foreground">
                    72%
                  </Badge>
                ) : null}
              </div>
            ))}
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
            Preview watch screen
            <CirclePlayIcon data-icon="inline-end" />
          </CartoonButton>
        </div>
      </StickerPanel>
      <MascotBubble tone="mint">
        Long videos will run as background jobs so mobile users can leave this
        screen and come back later.
      </MascotBubble>
    </section>
  );
}

function WatchScreen() {
  const subtitleEnabled = useAppStore((state) => state.subtitleEnabled);
  const subtitleSize = useAppStore((state) => state.subtitleSize);
  const subtitleOpacity = useAppStore((state) => state.subtitleOpacity);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const selectedVideo = useAppStore((state) => state.selectedVideo);

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
              onClick={() => setCurrentView("settings")}
              variant="secondary"
            >
              <SettingsIcon data-icon="inline-start" />
              SI subtitles
            </Button>
          </div>
        </div>
        <StickerCard className="overflow-hidden bg-vidura-ink p-0">
          <div className="relative aspect-video overflow-hidden bg-vidura-ink">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,#8b7cf6_0_9%,transparent_10%),radial-gradient(circle_at_70%_35%,#ffcf4a_0_5%,transparent_6%),radial-gradient(circle_at_50%_75%,#4ecdc4_0_7%,transparent_8%)]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="grid size-28 place-items-center rounded-full border-2 border-white bg-vidura-purple text-white shadow-[6px_6px_0_#ff6b5a] sm:size-40">
                <CirclePlayIcon className="size-16 sm:size-24" />
              </div>
            </div>
            {subtitleEnabled ? (
              <div
                className="absolute inset-x-4 bottom-14 mx-auto max-w-3xl rounded-md border-2 border-white px-3 py-2 text-center font-black leading-snug text-white shadow-[4px_4px_0_#000]"
                style={{
                  backgroundColor: `rgb(17 24 39 / ${subtitleOpacity / 100})`,
                  fontSize: `${subtitleSize}px`,
                }}
              >
                ක්වොන්ටම් භෞතිකයේ අංශු තත්ත්ව කිහිපයක තිබිය හැක.
              </div>
            ) : null}
            <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 text-white">
              <CirclePlayIcon className="size-5" />
              <div className="h-2 flex-1 rounded-full bg-white/25">
                <div className="h-2 w-[32%] rounded-full bg-vidura-coral" />
              </div>
              <span className="text-xs font-black">4:12 / 22:47</span>
            </div>
          </div>
        </StickerCard>
        <div className="grid gap-4 xl:hidden">
          <TranscriptPanel />
          <ChatPanel />
        </div>
        <div className="hidden xl:block">
          <TranscriptPanel />
        </div>
      </div>
      <aside className="hidden min-h-0 flex-col gap-4 xl:flex">
        <ChatPanel />
        <VideoInfoPanel />
      </aside>
    </section>
  );
}

function TranscriptPanel() {
  return (
    <StickerCard>
      <Tabs defaultValue="sinhala">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="font-display text-2xl font-black">
              Transcript
            </CardTitle>
            <TabsList className="border-2 border-foreground bg-vidura-cream">
              <TabsTrigger value="sinhala">Sinhala</TabsTrigger>
              <TabsTrigger value="bilingual">Bilingual</TabsTrigger>
            </TabsList>
          </div>
        </CardHeader>
        <CardContent>
          <TabsContent className="mt-0" value="sinhala">
            <TranscriptRows mode="sinhala" />
          </TabsContent>
          <TabsContent className="mt-0" value="bilingual">
            <TranscriptRows mode="bilingual" />
          </TabsContent>
        </CardContent>
      </Tabs>
    </StickerCard>
  );
}

function TranscriptRows({ mode }: { mode: "sinhala" | "bilingual" }) {
  return (
    <ScrollArea className="h-[260px] pr-3">
      <div className="flex flex-col gap-2">
        {transcript.map((segment, index) => (
          <button
            className={cn(
              "grid grid-cols-[56px_1fr] gap-3 rounded-md border-2 border-foreground bg-card p-3 text-left shadow-[2px_2px_0_var(--vidura-ink)]",
              index === 1 && "bg-vidura-mint"
            )}
            key={segment.id}
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
      </div>
    </ScrollArea>
  );
}

function ChatPanel() {
  const [draft, setDraft] = useState("");

  return (
    <StickerCard className="min-h-[360px]">
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
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {quickPrompts.slice(0, 3).map((prompt) => (
            <Button
              className="h-auto rounded-md border-2 border-foreground bg-vidura-cream px-3 py-2 text-xs"
              key={prompt}
              onClick={() => setDraft(prompt)}
              variant="outline"
            >
              {prompt}
            </Button>
          ))}
        </div>
        <ScrollArea className="h-[230px] pr-3">
          <div className="flex flex-col gap-3">
            {chatMessages.map((message) => (
              <div
                className={cn(
                  "max-w-[88%] rounded-lg border-2 border-foreground p-3 text-sm font-medium leading-relaxed shadow-[2px_2px_0_var(--vidura-ink)]",
                  message.role === "user"
                    ? "ml-auto bg-vidura-purple"
                    : "bg-card"
                )}
                key={message.id}
              >
                <p>{message.content}</p>
                {message.citation ? (
                  <Badge className="mt-2 border border-foreground bg-vidura-sun text-foreground">
                    {message.citation}
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>
        <InputGroup className="h-auto border-2 border-foreground bg-card">
          <InputGroupTextarea
            className="min-h-16"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about this video..."
            value={draft}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              className="bg-vidura-purple text-foreground"
              size="icon-sm"
            >
              <SendIcon />
              <span className="sr-only">Send message</span>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </CardContent>
    </StickerCard>
  );
}

function ChatScreen({ standalone = false }: { standalone?: boolean }) {
  return (
    <section className={cn("mx-auto max-w-3xl", standalone && "pt-0")}>
      <ChatPanel />
    </section>
  );
}

function VideoInfoPanel() {
  const selectedVideo = useAppStore((state) => state.selectedVideo);

  return (
    <StickerPanel title="Video info">
      <div className="flex gap-3">
        <div
          className={cn(
            "grid size-20 shrink-0 place-items-center rounded-md border-2 border-foreground",
            selectedVideo.accent
          )}
        >
          <selectedVideo.Icon className="size-9" />
        </div>
        <div>
          <p className="font-black leading-tight">{selectedVideo.title}</p>
          <p className="mt-1 text-xs font-semibold text-foreground/60">
            {selectedVideo.channel}
          </p>
        </div>
      </div>
      <Separator className="my-4" />
      <div className="flex flex-col gap-2">
        {["Add to watch later", "Share video", "Open in YouTube"].map((item) => (
          <Button
            className="justify-start border-2 border-foreground"
            key={item}
            variant="outline"
          >
            <ListVideoIcon data-icon="inline-start" />
            {item}
          </Button>
        ))}
      </div>
    </StickerPanel>
  );
}

function SettingsScreen() {
  const subtitleEnabled = useAppStore((state) => state.subtitleEnabled);
  const subtitleSize = useAppStore((state) => state.subtitleSize);
  const subtitleOpacity = useAppStore((state) => state.subtitleOpacity);
  const setSubtitleEnabled = useAppStore((state) => state.setSubtitleEnabled);
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
