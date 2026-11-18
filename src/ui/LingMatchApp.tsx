import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Gamepad2,
  Library,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Target,
  Timer,
  Trash2,
  Trophy,
  Upload,
  Volume2,
  VolumeX,
  Vibrate,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  GameResult,
  GameSettings,
  ImportOptions,
  ParsedImport,
  PairCount,
  StudyTask,
  StudyTaskMode,
  WordEntry,
  WordProgress,
  WordProgressState,
  WordLibrary,
  WordPairDraft,
} from "../types/domain";
import type { CompletedRoundResult, LearningDashboard, StudyTaskBundle } from "../features/learning/learningService";
import { parseLingMatchBackup } from "../features/backup/backupService";
import type { LingMatchBackup, RestoreStrategy, RestoreSummary } from "../features/backup/backupService";
import { LEARNING_STATUS_LABELS } from "../features/learning/learningEngine";
import { prepareMatchRound, type MatchCardItem } from "../features/matching/matchingEngine";
import "./lingmatch.css";

type Screen = "home" | "library" | "import" | "game";
type Theme = "light" | "dark";
type Delimiter = NonNullable<ImportOptions["delimiter"]>;

const STUDY_MODE_LABELS: Record<StudyTaskMode, string> = {
  new: "新词学习",
  weak: "薄弱词强化",
  due: "今日复习",
  comprehensive: "全词库智能练习",
};

function getStudyTaskProgress(task: StudyTask): string {
  return `已完成 ${task.completedWordIds.length} / ${task.plannedWordIds.length} 个计划词`
}

export interface LingMatchAppProps {
  libraries: WordLibrary[];
  settings: GameSettings;
  history: GameResult[];
  listWords(libraryId: string): Promise<WordEntry[]>;
  parseFile(file: File, options?: ImportOptions): Promise<ParsedImport>;
  createLibrary(name: string, words: WordPairDraft[]): Promise<void>;
  replaceLibraryWords(libraryId: string, words: WordPairDraft[]): Promise<void>;
  renameLibrary(id: string, name: string): Promise<void>;
  deleteLibrary(id: string): Promise<void>;
  saveSettings(settings: GameSettings): Promise<void>;
  createStudyTask(libraryId: string, mode: StudyTaskMode, roundSize: PairCount, targetCount?: number): Promise<StudyTaskBundle>;
  resumeStudyTask(taskId: string): Promise<StudyTaskBundle>;
  pauseStudyTask(taskId: string): Promise<void>;
  recordPairResolution(input: { taskId: string; roundNumber: number; englishWordId: string; chineseWordId: string; correct: boolean }): Promise<StudyTask>;
  completeStudyRound(taskId: string, roundNumber: number, durationSeconds: number): Promise<CompletedRoundResult>;
  getLearningDashboard(libraryId: string): Promise<LearningDashboard>;
  getLearningProgress(libraryId: string): Promise<WordProgress[]>;
  exportBackup(): Promise<LingMatchBackup>;
  restoreBackup(backup: unknown, strategy: RestoreStrategy): Promise<RestoreSummary>;
  theme?: Theme;
  saveTheme?(theme: Theme): Promise<void>;
}

const DEFAULT_SETTINGS: GameSettings = {
  pairsPerRound: 8,
  timerEnabled: false,
  soundEnabled: false,
  vibrationEnabled: false,
};

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
};

const getAccuracy = (result: GameResult) => {
  const attempts = result.correctPairs + (result.mistakes ?? 0);
  return attempts === 0 ? 100 : Math.round((result.correctPairs / attempts) * 100);
};

function buildPreviewRows(parsed: ParsedImport, options: ImportOptions): WordPairDraft[] {
  if (!parsed.sourceRows?.length) return parsed.words.map(({ english, chinese }) => ({ english, chinese }));
  const englishColumn = options.englishColumn ?? parsed.suggestedEnglishColumn ?? parsed.columns?.[0]?.index ?? 0;
  const chineseColumn = options.chineseColumn ?? parsed.suggestedChineseColumn ?? parsed.columns?.[1]?.index ?? (englishColumn === 0 ? 1 : 0);
  return parsed.sourceRows
    .slice(parsed.hasHeader ? 1 : 0)
    .map((row) => ({ english: row[englishColumn] ?? "", chinese: row[chineseColumn] ?? "" }))
    .filter((row) => row.english.trim().length > 0 || row.chinese.trim().length > 0);
}

export function LingMatchApp(props: LingMatchAppProps) {
  const shouldReduceMotion = useReducedMotion();
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedLibraryId, setSelectedLibraryId] = useState(props.libraries[0]?.id ?? "");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(props.theme ?? "light");
  const [gameWords, setGameWords] = useState<WordEntry[]>([]);
  const [studyTask, setStudyTask] = useState<StudyTask | undefined>();
  const [learningDashboard, setLearningDashboard] = useState<LearningDashboard | undefined>();
  const [replaceTargetId, setReplaceTargetId] = useState("");
  const [gameSeed, setGameSeed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [appError, setAppError] = useState("");
  const newIdsBeforeCreate = useRef<Set<string> | null>(null);
  const pendingLibraryName = useRef("");

  useEffect(() => {
    if (props.theme) setTheme(props.theme);
  }, [props.theme]);

  useEffect(() => {
    if (props.libraries.length === 0) {
      setSelectedLibraryId("");
      return;
    }
    if (!props.libraries.some((library) => library.id === selectedLibraryId)) {
      setSelectedLibraryId(props.libraries[0]?.id ?? "");
    }
  }, [props.libraries, selectedLibraryId]);

  useEffect(() => {
    if (!pendingLibraryName.current || !newIdsBeforeCreate.current) return;
    const created = props.libraries.find(
      (library) => !newIdsBeforeCreate.current?.has(library.id) && library.name === pendingLibraryName.current,
    );
    if (created) {
      setSelectedLibraryId(created.id);
      pendingLibraryName.current = "";
      newIdsBeforeCreate.current = null;
    }
  }, [props.libraries]);

  const activeLibrary = props.libraries.find((library) => library.id === selectedLibraryId);
  const resumableTask = learningDashboard?.resumableTask;
  const unfinishedTasks = learningDashboard?.unfinishedTasks ?? [];
  const loadLearningDashboard = props.getLearningDashboard;
  const openImport = (libraryId = "") => { setReplaceTargetId(libraryId); setScreen("import"); };

  useEffect(() => {
    let cancelled = false;
    if (!activeLibrary) {
      setLearningDashboard(undefined);
      return;
    }
    void loadLearningDashboard(activeLibrary.id).then((dashboard) => {
      if (cancelled) return;
      setLearningDashboard(dashboard);
    }).catch((cause) => {
      if (!cancelled) setAppError(cause instanceof Error ? cause.message : "暂时无法读取学习进度。");
    });
    return () => { cancelled = true; };
  }, [activeLibrary?.id, screen, loadLearningDashboard]);

  const handleStartGame = useCallback(async (mode: StudyTaskMode = "comprehensive") => {
    if (!activeLibrary) {
      openImport();
      return;
    }
    setBusy(true);
    setAppError("");
    try {
      const bundle = await props.createStudyTask(activeLibrary.id, mode, props.settings.pairsPerRound);
      setStudyTask(bundle.task);
      setGameWords(bundle.words);
      setGameSeed((seed) => seed + 1);
      const dashboard = await props.getLearningDashboard(activeLibrary.id);
      setLearningDashboard(dashboard);
      setScreen("game");
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "读取词库失败，请再试一次。");
    } finally {
      setBusy(false);
    }
  }, [activeLibrary, props]);

  const handleResumeGame = useCallback(async (taskId = resumableTask?.id) => {
    if (!taskId) return;
    setBusy(true);
    setAppError("");
    try {
      const bundle = await props.resumeStudyTask(taskId);
      setStudyTask(bundle.task);
      setGameWords(bundle.words);
      setGameSeed((seed) => seed + 1);
      const dashboard = await props.getLearningDashboard(bundle.task.libraryId);
      setLearningDashboard(dashboard);
      setScreen("game");
    } catch (cause) {
      setAppError(cause instanceof Error ? cause.message : "恢复学习任务失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, [props, resumableTask?.id]);

  const handlePauseGame = useCallback(async () => {
    if (studyTask) await props.pauseStudyTask(studyTask.id);
    setScreen("home");
    if (studyTask) {
      const dashboard = await props.getLearningDashboard(studyTask.libraryId);
      setLearningDashboard(dashboard);
    }
  }, [props, studyTask]);

  const handleFinishRound = useCallback(async (durationSeconds: number) => {
    if (!studyTask) throw new Error("找不到当前学习任务，请返回首页后继续。");
    const result = await props.completeStudyRound(studyTask.id, studyTask.roundNumber, durationSeconds);
    setStudyTask(result.task);
    if (result.task.status !== "completed") {
      setGameWords(result.words);
      setGameSeed((seed) => seed + 1);
    }
    const dashboard = await props.getLearningDashboard(result.task.libraryId);
    setLearningDashboard(dashboard);
    return result;
  }, [props, studyTask]);

  const handleCreateLibrary = async (name: string, words: WordPairDraft[]) => {
    newIdsBeforeCreate.current = new Set(props.libraries.map((library) => library.id));
    pendingLibraryName.current = name;
    await props.createLibrary(name, words);
  };

  const handleThemeChange = async (nextTheme: Theme) => {
    setTheme(nextTheme);
    await props.saveTheme?.(nextTheme);
  };

  return (
    <div className="lm-app" data-theme={theme}>
      {screen !== "game" && (
        <Header
          screen={screen}
          activeLibrary={activeLibrary}
          libraries={props.libraries}
          onScreenChange={setScreen}
          onSelectLibrary={setSelectedLibraryId}
          onOpenSettings={() => setSettingsOpen(true)}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      )}

      <main className={`lm-main ${screen === "game" ? "lm-main-game" : ""}`}>
        {appError && screen !== "game" && (
          <div className="lm-inline-alert" role="status">
            <CircleHelp size={17} />
            <span>{appError}</span>
            <button className="lm-icon-button lm-alert-close" aria-label="关闭提示" onClick={() => setAppError("")}><X size={16} /></button>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {screen === "home" && (
            <motion.div key="home" className="lm-screen" initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }} transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}>
              <HomeScreen
                libraries={props.libraries}
                activeLibrary={activeLibrary}
                selectedLibraryId={selectedLibraryId}
                settings={props.settings ?? DEFAULT_SETTINGS}
                history={props.history}
                learningDashboard={learningDashboard}
                resumableTask={resumableTask}
                unfinishedTasks={unfinishedTasks}
                busy={busy}
                onStart={handleStartGame}
                onResume={handleResumeGame}
                onImport={() => openImport()}
                onLibrary={() => setScreen("library")}
                onSelectLibrary={setSelectedLibraryId}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </motion.div>
          )}
          {screen === "library" && (
            <motion.div key="library" className="lm-screen" initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }} transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}>
              <LibraryScreen
                libraries={props.libraries}
                selectedLibraryId={selectedLibraryId}
                listWords={props.listWords}
                getLearningProgress={props.getLearningProgress}
                onSelect={setSelectedLibraryId}
                onBack={() => setScreen("home")}
                onImport={() => openImport()}
                onReimport={(id) => openImport(id)}
                onCreateLibrary={handleCreateLibrary}
                onRename={props.renameLibrary}
                onDelete={async (id) => {
                  await props.deleteLibrary(id);
                  if (id === selectedLibraryId) setSelectedLibraryId("");
                }}
                exportBackup={props.exportBackup}
                restoreBackup={props.restoreBackup}
              />
            </motion.div>
          )}
          {screen === "import" && (
            <motion.div key="import" className="lm-screen" initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }} transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}>
              <ImportScreen
                parseFile={props.parseFile}
                onCreateLibrary={handleCreateLibrary}
                replaceLibraryId={replaceTargetId}
                replaceLibrary={props.libraries.find((library) => library.id === replaceTargetId)}
                onReplaceLibrary={props.replaceLibraryWords}
                onCancel={() => setScreen(replaceTargetId ? "library" : "home")}
                onComplete={() => { setScreen(replaceTargetId ? "library" : "home"); setReplaceTargetId(""); }}
              />
            </motion.div>
          )}
          {screen === "game" && activeLibrary && (
            <motion.div key={`game-${gameSeed}`} className="lm-screen" initial={shouldReduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={shouldReduceMotion ? undefined : { opacity: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}>
              <MatchGame
                key={gameSeed}
                library={activeLibrary}
                entries={gameWords}
                task={studyTask!}
                settings={props.settings ?? DEFAULT_SETTINGS}
                onExit={() => void handlePauseGame()}
                onRecordPairResolution={props.recordPairResolution}
                onFinish={handleFinishRound}
                onReplay={handleStartGame}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {screen !== "game" && <MobileNavigation screen={screen} onScreenChange={setScreen} onImport={() => openImport()} />}

      <AnimatePresence>
        {settingsOpen && (
          <SettingsDialog
            settings={props.settings ?? DEFAULT_SETTINGS}
            theme={theme}
            onThemeChange={handleThemeChange}
            onSave={props.saveSettings}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface HeaderProps {
  screen: Screen;
  activeLibrary?: WordLibrary;
  libraries: WordLibrary[];
  onScreenChange: (screen: Screen) => void;
  onSelectLibrary: (id: string) => void;
  onOpenSettings: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

function Header({ screen, activeLibrary, libraries, onScreenChange, onSelectLibrary, onOpenSettings, theme, onThemeChange }: HeaderProps) {
  return (
    <header className="lm-header">
      <button className="lm-brand" aria-label="LingMatch 首页" onClick={() => onScreenChange("home")}>
        <span className="lm-brand-mark"><span /><span /></span>
        <span>Ling<span>Match</span></span>
      </button>
      <nav className="lm-header-nav" aria-label="主导航">
        <button className={screen === "home" ? "is-active" : ""} onClick={() => onScreenChange("home")}>首页</button>
        <button className={screen === "library" ? "is-active" : ""} onClick={() => onScreenChange("library")}>我的词库</button>
      </nav>
      <div className="lm-header-actions">
        {libraries.length > 0 && (
          <label className="lm-library-select-wrap">
            <span className="sr-only">当前词库</span>
            <Library size={16} />
            <select value={activeLibrary?.id ?? ""} onChange={(event) => onSelectLibrary(event.target.value)} aria-label="选择当前词库">
              {libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
            <ChevronDown size={14} />
          </label>
        )}
        <button className="lm-icon-button lm-theme-button" aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"} onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="lm-icon-button lm-header-settings" aria-label="打开设置" onClick={onOpenSettings}><Settings2 size={19} /></button>
      </div>
    </header>
  );
}

interface HomeScreenProps {
  libraries: WordLibrary[];
  activeLibrary?: WordLibrary;
  selectedLibraryId: string;
  settings: GameSettings;
  history: GameResult[];
  learningDashboard?: LearningDashboard;
  resumableTask?: StudyTask;
  unfinishedTasks: StudyTask[];
  busy: boolean;
  onStart: (mode?: StudyTaskMode) => void;
  onResume: (taskId?: string) => void;
  onImport: () => void;
  onLibrary: () => void;
  onSelectLibrary: (id: string) => void;
  onOpenSettings: () => void;
}

function HomeScreen({ libraries, activeLibrary, selectedLibraryId, settings, history, learningDashboard, resumableTask, unfinishedTasks, busy, onStart, onResume, onImport, onLibrary, onSelectLibrary, onOpenSettings }: HomeScreenProps) {
  const recentResults = history.filter((result) => result.libraryId === activeLibrary?.id).slice(0, 3);
  const count = activeLibrary?.wordCount ?? 0;
  return (
    <section className="lm-home">
      <div className="lm-home-topline">
        <span className="lm-eyebrow"><span className="lm-eyebrow-dot" /> 轻松复习，每天一点</span>
        <button className="lm-text-button lm-home-settings" onClick={onOpenSettings}><Settings2 size={16} /> 配对设置</button>
      </div>
      <div className="lm-hero-grid">
        <div className="lm-hero-copy">
          <h1>让单词，<br /><span>成双成对。</span></h1>
          <p>轻轻一点，找到英文和中文的默契。几分钟，让记忆再清晰一点。</p>
          {libraries.length > 0 && (
            <label className="lm-active-collection">
              <span className="lm-collection-icon"><BookOpen size={17} /></span>
              <span className="lm-collection-info">
                <span>本轮练习词库</span>
                <select value={selectedLibraryId} onChange={(event) => onSelectLibrary(event.target.value)} aria-label="选择练习词库">
                  {libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
                </select>
              </span>
              <span className="lm-collection-count">{count}<small> 词</small></span>
            </label>
          )}
          <div className="lm-hero-actions">
            <button className="lm-button lm-button-primary lm-start-button" disabled={busy || count === 0} onClick={() => onStart()}>
              <Gamepad2 size={19} />{busy ? "准备中…" : "开始配对"}<ChevronRight size={17} />
            </button>
            <button className="lm-button lm-button-secondary" onClick={onImport}><Upload size={17} /> 导入词库</button>
          </div>
          {!activeLibrary && <p className="lm-hint">先导入你的词表，就可以开始第一轮配对。</p>}
          {activeLibrary && count === 0 && <p className="lm-hint">这个词库还没有词条，导入词表后即可开始。</p>}
        </div>

        <div className="lm-hero-art" aria-hidden="true">
          <div className="lm-art-orbit lm-art-orbit-one" />
          <div className="lm-art-orbit lm-art-orbit-two" />
          <Sparkles className="lm-art-spark lm-art-spark-one" size={22} />
          <Sparkles className="lm-art-spark lm-art-spark-two" size={19} />
          <div className="lm-art-pair lm-art-pair-english"><span>English</span><strong>serendipity</strong></div>
          <div className="lm-art-link"><span /><i /><span /></div>
          <div className="lm-art-pair lm-art-pair-chinese"><span>中文</span><strong>不期而遇</strong></div>
          <div className="lm-art-caption"><CheckCircle2 size={15} /> 一对刚刚好</div>
        </div>
      </div>

      {activeLibrary && learningDashboard && <section className="lm-study-planner" aria-label="学习计划">
        <div className="lm-section-heading"><div><span className="lm-eyebrow">按当前学习状态安排</span><h2>今天学什么？</h2></div><span className="lm-planner-total"><strong>{learningDashboard.candidateWordCounts.due}</strong> 个待复习</span></div>
        <div className="lm-learning-snapshot">
          <span>未学习 <strong>{learningDashboard.stats.new}</strong></span><i />
          <span>学习中 <strong>{learningDashboard.stats.learning}</strong></span><i />
          <span>薄弱 <strong>{learningDashboard.stats.weak}</strong></span><i />
          <span>熟悉 <strong>{learningDashboard.stats.familiar}</strong></span><i />
          <span>掌握 <strong>{learningDashboard.stats.mastered}</strong></span>
        </div>
        <div className="lm-study-modes">
          {([
            { mode: "due", title: "今日复习", count: learningDashboard.candidateWordCounts.due, hint: "只练已到期词" },
            { mode: "weak", title: "薄弱词强化", count: learningDashboard.candidateWordCounts.weak, hint: "改善后自动退出候选" },
            { mode: "new", title: "新词学习", count: learningDashboard.candidateWordCounts.new, hint: `本次安排 ${Math.min(50, learningDashboard.candidateWordCounts.new)} 个，最多 50 个` },
            { mode: "comprehensive", title: "全词库智能练习", count: learningDashboard.candidateWordCounts.comprehensive, hint: "按记忆状态排序，完整覆盖" },
          ] as const).map((item) => <button className="lm-study-mode" key={item.mode} disabled={busy || item.count === 0} onClick={() => onStart(item.mode)}>
            <strong>{item.title}</strong><span>{item.hint}</span><small>{item.mode === "new" ? `${item.count} 可学` : `${item.count} 词`}</small>
          </button>)}
        </div>
        {resumableTask && <button className="lm-resume-task" disabled={busy} onClick={() => onResume()}><span><strong>继续上次学习</strong><small>{getStudyTaskProgress(resumableTask)}</small></span><ChevronRight size={18} /></button>}
        {unfinishedTasks.length > 1 && <div className="lm-task-switch-list" aria-label="其他未完成任务">
          <span>其他未完成任务</span>
          {unfinishedTasks.filter((task) => task.id !== resumableTask?.id).map((task) => <button key={task.id} disabled={busy} onClick={() => onResume(task.id)}>
            <span><strong>{STUDY_MODE_LABELS[task.mode]}</strong><small>{task.status === "in-progress" ? "进行中" : "已暂停"} · {getStudyTaskProgress(task)}</small></span><ChevronRight size={15} />
          </button>)}
        </div>}
      </section>}

      <div className="lm-home-lower">
        <div className="lm-quick-stats">
          <div className="lm-stat-block"><span>我的词库</span><strong>{libraries.length}<small> 个</small></strong></div>
          <div className="lm-stat-divider" />
          <div className="lm-stat-block"><span>本轮配对</span><strong>{settings.pairsPerRound}<small> 组</small></strong></div>
          <button className="lm-mini-settings" aria-label="修改配对数量" onClick={onOpenSettings}><Settings2 size={16} /></button>
        </div>
        <button className="lm-library-link" onClick={onLibrary}><span className="lm-library-link-icon"><FolderOpen size={18} /></span><span><strong>整理词库</strong><small>查看、重命名或管理词条</small></span><ChevronRight size={18} /></button>
      </div>

      {recentResults.length > 0 && (
        <section className="lm-recent">
          <div className="lm-section-heading"><div><span className="lm-eyebrow">最近几轮</span><h2>继续保持好手感</h2></div><span className="lm-history-mark"><Target size={17} /></span></div>
          <div className="lm-result-strip">
            {recentResults.map((result) => <div className="lm-result-chip" key={result.id}><span>{formatDuration(result.duration)}</span><strong>{getAccuracy(result)}%</strong><small>准确率</small></div>)}
          </div>
        </section>
      )}
    </section>
  );
}

type LibraryStatusFilter = WordProgressState | "all";
type LibrarySort = "original" | "newest" | "english" | "status";
type ImportPreviewFilter = "all" | "abnormal" | "incomplete" | "duplicate" | "suspicious";
type LibraryViewState = { query: string; status: LibraryStatusFilter; sort: LibrarySort; page: number };

const LIBRARY_PAGE_SIZE = 40;
const LIBRARY_VIEW_DEFAULT: LibraryViewState = { query: "", status: "all", sort: "original", page: 1 };
const LIBRARY_VIEW_STORAGE_PREFIX = "lingmatch-library-view-v5:";
const LIBRARY_STATUS_ORDER: WordProgressState[] = ["new", "learning", "weak", "familiar", "mastered"];

function readLibraryView(libraryId: string): LibraryViewState {
  if (!libraryId) return LIBRARY_VIEW_DEFAULT;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(`${LIBRARY_VIEW_STORAGE_PREFIX}${libraryId}`) ?? "null") as Partial<LibraryViewState> | null;
    return {
      query: typeof parsed?.query === "string" ? parsed.query : "",
      status: parsed?.status === "all" || (parsed?.status && LIBRARY_STATUS_ORDER.includes(parsed.status)) ? parsed.status : "all",
      sort: parsed?.sort === "newest" || parsed?.sort === "english" || parsed?.sort === "status" ? parsed.sort : "original",
      page: typeof parsed?.page === "number" && Number.isInteger(parsed.page) && parsed.page > 0 ? parsed.page : 1,
    };
  } catch {
    return LIBRARY_VIEW_DEFAULT;
  }
}

function persistLibraryView(libraryId: string, view: LibraryViewState) {
  if (!libraryId) return;
  try { window.sessionStorage.setItem(`${LIBRARY_VIEW_STORAGE_PREFIX}${libraryId}`, JSON.stringify(view)); } catch { /* Storage may be disabled in a restricted WebView. */ }
}

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange(page: number): void;
  scrollTargetId: string;
  label: string;
}

function Pager({ page, pageSize, total, onPageChange, scrollTargetId, label }: PagerProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const [pageDraft, setPageDraft] = useState(String(currentPage));
  useEffect(() => setPageDraft(String(currentPage)), [currentPage]);
  const jump = () => {
    const requested = Number(pageDraft);
    const next = Number.isInteger(requested) ? Math.max(1, Math.min(pageCount, requested)) : currentPage;
    setPageDraft(String(next));
    onPageChange(next);
  };
  const backToTop = () => {
    onPageChange(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return <nav className="lm-list-pagination" aria-label={label}>
    <span className="lm-pagination-count">{total} 条 · 第 {currentPage} / {pageCount} 页</span>
    <div className="lm-pagination-controls">
      <button type="button" disabled={currentPage <= 1} onClick={() => onPageChange(1)}>首页</button>
      <button type="button" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>上一页</button>
      <label>跳至 <input aria-label="跳到指定页" type="number" min={1} max={pageCount} value={pageDraft} onChange={(event) => setPageDraft(event.target.value)} onBlur={jump} onKeyDown={(event) => { if (event.key === "Enter") jump(); }} /> / {pageCount}</label>
      <button type="button" disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)}>下一页</button>
      <button type="button" disabled={currentPage >= pageCount} onClick={() => onPageChange(pageCount)}>末页</button>
      <button type="button" onClick={backToTop}>回到顶部</button>
      <button type="button" className="lm-pagination-locate" onClick={() => document.getElementById(scrollTargetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}>定位结果</button>
    </div>
  </nav>;
}

interface LibraryScreenProps {
  libraries: WordLibrary[];
  selectedLibraryId: string;
  listWords: (libraryId: string) => Promise<WordEntry[]>;
  getLearningProgress: (libraryId: string) => Promise<WordProgress[]>;
  onSelect: (id: string) => void;
  onBack: () => void;
  onImport: () => void;
  onReimport: (id: string) => void;
  onCreateLibrary: (name: string, words: WordPairDraft[]) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  exportBackup: () => Promise<LingMatchBackup>;
  restoreBackup: (backup: unknown, strategy: RestoreStrategy) => Promise<RestoreSummary>;
}

function LibraryScreen({ libraries, selectedLibraryId, listWords, getLearningProgress, onSelect, onBack, onImport, onReimport, onCreateLibrary, onRename, onDelete, exportBackup, restoreBackup }: LibraryScreenProps) {
  const [entries, setEntries] = useState<WordEntry[]>([]);
  const [wordProgress, setWordProgress] = useState<WordProgress[]>([]);
  const [viewsByLibrary, setViewsByLibrary] = useState<Record<string, LibraryViewState>>({});
  const view = viewsByLibrary[selectedLibraryId] ?? readLibraryView(selectedLibraryId);
  const query = view.query;
  const statusFilter = view.status;
  const sort = view.sort;
  const queryRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [restoreStrategy, setRestoreStrategy] = useState<RestoreStrategy>("merge");
  const [pendingRestoreBackup, setPendingRestoreBackup] = useState<LingMatchBackup | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<"create" | "rename" | "delete" | "restore" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const selected = libraries.find((library) => library.id === selectedLibraryId);

  const updateView = (patch: Partial<LibraryViewState>) => {
    const next = { ...view, ...patch };
    setViewsByLibrary((current) => ({ ...current, [selectedLibraryId]: next }));
    persistLibraryView(selectedLibraryId, next);
  };

  useEffect(() => {
    let cancelled = false;
    if (!selectedLibraryId) { setEntries([]); setWordProgress([]); return; }
    setLoading(true);
    Promise.all([listWords(selectedLibraryId), getLearningProgress(selectedLibraryId)])
      .then(([words, progress]) => { if (!cancelled) { setEntries(words); setWordProgress(progress); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "读取词条失败。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedLibraryId, listWords, getLearningProgress, libraries]);

  const progressByWordId = useMemo(() => new Map(wordProgress.map((progress) => [progress.wordId, progress])), [wordProgress]);

  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = entries.filter((word) => {
      const matchesQuery = !normalized
        || word.english.toLocaleLowerCase().includes(normalized)
        || word.chinese.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
      const matchesStatus = statusFilter === "all" || (progressByWordId.get(word.id)?.state ?? "new") === statusFilter;
      return matchesQuery && matchesStatus;
    });
    const statusIndex = (word: WordEntry) => LIBRARY_STATUS_ORDER.indexOf(progressByWordId.get(word.id)?.state ?? "new");
    if (sort === "newest") return filtered.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
    if (sort === "english") return filtered.sort((left, right) => left.english.localeCompare(right.english, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id));
    if (sort === "status") return filtered.sort((left, right) => statusIndex(left) - statusIndex(right) || left.english.localeCompare(right.english));
    return filtered;
  }, [entries, progressByWordId, query, sort, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleEntries.length / LIBRARY_PAGE_SIZE));
  const currentPage = Math.min(view.page, pageCount);
  const pageEntries = visibleEntries.slice((currentPage - 1) * LIBRARY_PAGE_SIZE, currentPage * LIBRARY_PAGE_SIZE);

  useEffect(() => {
    if (view.page > pageCount) updateView({ page: pageCount });
  }, [view.page, pageCount]);

  const onSearchChange = (value: string) => updateView({ query: value, page: 1 });
  const onStatusFilterChange = (value: LibraryStatusFilter) => updateView({ status: value, page: 1 });
  const onSortChange = (value: LibrarySort) => updateView({ sort: value, page: 1 });

  const downloadBackup = async () => {
    setBackupBusy(true); setBackupMessage(""); setError("");
    try {
      const backup = await exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `LingMatch-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setBackupMessage("完整备份已导出到此设备。请妥善保存 JSON 文件。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出备份失败。");
    } finally {
      setBackupBusy(false);
    }
  };

  const applyRestore = async (backup: LingMatchBackup, strategy: RestoreStrategy) => {
    const summary = await restoreBackup(backup, strategy);
    const added = Object.values(summary).reduce((sum, store) => sum + store.added, 0);
    const kept = Object.values(summary).reduce((sum, store) => sum + store.kept, 0);
    const removed = Object.values(summary).reduce((sum, store) => sum + store.removed, 0);
    const [words, progress] = await Promise.all([listWords(selectedLibraryId), getLearningProgress(selectedLibraryId)]);
    setEntries(words); setWordProgress(progress);
    setBackupMessage(strategy === "replace"
      ? `完整替换完成：恢复 ${added} 条备份记录，替换前移除了 ${removed} 条本机记录。`
      : `合并完成：补入 ${added} 条记录，保留本机冲突项 ${kept} 条。`);
  };

  const restoreFromFile = async (file?: File) => {
    if (!file) return;
    setBackupBusy(true); setBackupMessage(""); setError("");
    try {
      const backup = parseLingMatchBackup(JSON.parse(await file.text()));
      if (restoreStrategy === "replace") {
        setPendingRestoreBackup(backup);
        setBackupMessage(`备份已验证：${backup.data.libraries.length} 个词库、${backup.data.words.length} 个词条。确认后将替换这台设备上的全部 LingMatch 数据。`);
        setModal("restore");
      } else {
        await applyRestore(backup, "merge");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法恢复这个备份；现有数据未更改。");
    } finally {
      setBackupBusy(false);
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  };

  const confirmReplaceRestore = async () => {
    if (!pendingRestoreBackup || backupBusy) return;
    setBackupBusy(true); setError(""); setBackupMessage("");
    try {
      await applyRestore(pendingRestoreBackup, "replace");
      setPendingRestoreBackup(null); setModal(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "替换失败；原有数据已保留。");
    } finally {
      setBackupBusy(false);
    }
  };

  const openRename = () => { setName(selected?.name ?? ""); setError(""); setModal("rename"); };
  const openCreate = () => { setName(""); setError(""); setModal("create"); };
  const closeModal = () => { setModal(null); setError(""); if (modal === "restore") setPendingRestoreBackup(null); };

  const submitName = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("请给词库起个名字。"); return; }
    try {
      if (modal === "create") await onCreateLibrary(trimmed, []);
      if (modal === "rename" && selected) await onRename(selected.id, trimmed);
      closeModal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请再试一次。");
    }
  };

  const confirmDelete = async () => {
    if (!selected) return;
    try { await onDelete(selected.id); closeModal(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败，请再试一次。"); }
  };

  return (
    <section className="lm-library-page">
      <div className="lm-page-heading">
        <button className="lm-back-link" onClick={onBack}><ChevronLeft size={17} /> 返回首页</button>
        <div className="lm-page-heading-row"><div><span className="lm-eyebrow">收纳有序，复习更轻松</span><h1>我的词库</h1><p>管理自己的词表，保持每个词库清爽好用。</p></div><button className="lm-button lm-button-primary" onClick={openCreate}><Plus size={18} /> 新建词库</button></div>
      </div>

      <div className="lm-library-layout">
        <aside className="lm-library-list" aria-label="词库列表">
          <div className="lm-library-list-title"><span>词库</span><span>{libraries.length}</span></div>
          {libraries.length === 0 ? <div className="lm-library-empty-small">还没有词库。<button onClick={onImport}>导入第一份词表</button></div> : libraries.map((library) => (
            <button className={`lm-library-row ${library.id === selectedLibraryId ? "is-selected" : ""}`} key={library.id} onClick={() => onSelect(library.id)}>
              <span className="lm-library-row-icon"><BookOpen size={17} /></span><span className="lm-library-row-copy"><strong>{library.name}</strong><small>{library.wordCount} 个词条</small></span><ChevronRight size={16} />
            </button>
          ))}
          <button className="lm-library-add-row" onClick={onImport}><span><Upload size={16} /></span>导入新词库</button>
        </aside>

        <div className="lm-library-detail">
          {selected ? (
            <>
              <div className="lm-library-detail-head">
                <div><span className="lm-eyebrow">当前词库</span><h2>{selected.name}</h2><p>{selected.wordCount} 个词条 · 随时可以开始配对</p></div>
                <div className="lm-detail-actions"><button className="lm-icon-button" aria-label="重命名词库" onClick={openRename}><Pencil size={17} /></button><button className="lm-icon-button lm-danger-icon" aria-label="删除词库" onClick={() => { setError(""); setModal("delete"); }}><Trash2 size={17} /></button></div>
              </div>
              <div className="lm-backup-toolbar">
                <span><strong>数据备份</strong><small>包含词库、进度、练习历史与设置</small></span>
                <div><button className="lm-button lm-button-secondary lm-compact-button" disabled={backupBusy} onClick={() => void downloadBackup()}><Download size={15} /> 导出 JSON</button><button className="lm-button lm-button-secondary lm-compact-button" disabled={backupBusy} onClick={() => backupInputRef.current?.click()}><Upload size={15} /> 恢复备份</button></div>
                <input ref={backupInputRef} className="sr-only" type="file" accept="application/json,.json" aria-label="选择 LingMatch JSON 备份" onChange={(event) => void restoreFromFile(event.target.files?.[0])} />
              </div>
              <fieldset className="lm-restore-strategies" disabled={backupBusy}>
                <legend>选择恢复方式</legend>
                <label><input type="radio" name="restore-strategy" value="merge" checked={restoreStrategy === "merge"} onChange={() => setRestoreStrategy("merge")} /><span><strong>合并备份</strong><small>补回缺少的记录；相同 ID 的本机内容保留。</small></span></label>
                <label><input type="radio" name="restore-strategy" value="replace" checked={restoreStrategy === "replace"} onChange={() => setRestoreStrategy("replace")} /><span><strong>完整替换</strong><small>先校验并二次确认；替换全部词库、词条、进度、历史和设置。</small></span></label>
              </fieldset>
              {backupMessage && <p className="lm-backup-message" role="status">{backupMessage}</p>}
              <div className="lm-words-toolbar">
                <div className="lm-search"><Search size={17} /><input ref={queryRef} value={query} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索英文或中文" aria-label="搜索英文或中文词条" /></div>
                <select aria-label="按学习状态筛选" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as LibraryStatusFilter)}><option value="all">全部状态</option>{(Object.entries(LEARNING_STATUS_LABELS) as [WordProgressState, string][]).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select>
                <select aria-label="词条排序方式" value={sort} onChange={(event) => onSortChange(event.target.value as LibrarySort)}><option value="original">原始顺序</option><option value="newest">最新添加</option><option value="english">英文 A–Z</option><option value="status">学习状态</option></select>
                <button className="lm-button lm-button-secondary lm-compact-button" onClick={() => onReimport(selected.id)}><Upload size={16} /> 替换词表</button><button className="lm-button lm-button-secondary lm-compact-button" onClick={onImport}><Plus size={16} /> 新建词库</button>
              </div>
              {loading ? <div className="lm-loading-state">正在读取词条…</div> : entries.length === 0 ? (
                <div className="lm-empty-words"><span><BookOpen size={22} /></span><h3>词库还空着</h3><p>导入一份中英词表，开始你的第一轮配对。</p><button className="lm-button lm-button-primary" onClick={onImport}><Upload size={17} /> 导入词表</button></div>
              ) : visibleEntries.length === 0 ? <div className="lm-loading-state">没有找到匹配的词条。</div> : (
                <div className="lm-word-list-wrap" id="lm-word-list">
                  <div className="lm-word-list-labels"><span>ENGLISH</span><span>中文释义</span><span>自动学习状态</span></div>
                  <div className="lm-word-list">{pageEntries.map((word) => {
                    const state = progressByWordId.get(word.id)?.state ?? "new";
                    return <div className="lm-word-row" key={word.id}><span className="lm-word-english">{word.english}</span><details className="lm-word-definition"><summary title={word.chinese}>{word.chinese}</summary><div>{word.chinese}</div></details><span className={`lm-word-state is-${state}`}>{LEARNING_STATUS_LABELS[state]}</span></div>;
                  })}</div>
                  <Pager page={currentPage} pageSize={LIBRARY_PAGE_SIZE} total={visibleEntries.length} onPageChange={(page) => updateView({ page })} scrollTargetId="lm-word-list" label="词库分页" />
                </div>
              )}
            </>
          ) : (
            <div className="lm-empty-words"><span><Library size={22} /></span><h3>先建一个词库</h3><p>导入你自己的中英词表，几秒钟就能开始复习。</p><div className="lm-empty-actions"><button className="lm-button lm-button-primary" onClick={onImport}><Upload size={17} /> 导入词表</button><button className="lm-button lm-button-secondary" onClick={openCreate}><Plus size={17} /> 新建空词库</button></div></div>
          )}
        </div>
      </div>
      {error && !modal && <div className="lm-inline-alert" role="alert">{error}</div>}

      <AnimatePresence>
        {modal && <Dialog onClose={closeModal} title={modal === "create" ? "新建词库" : modal === "rename" ? "重命名词库" : modal === "restore" ? "确认完整替换？" : "删除词库？"}>
          {modal === "restore" ? <><p className="lm-dialog-copy">已通过完整格式和引用检查。继续后将以备份中的全部数据替换此设备当前所有 LingMatch 词库、词条、学习档案、练习历史、未完成任务和设置。该操作无法撤销。</p>{error && <p className="lm-form-error" role="alert">{error}</p>}<div className="lm-dialog-actions"><button className="lm-button lm-button-secondary" disabled={backupBusy} onClick={closeModal}>取消</button><button className="lm-button lm-button-danger" disabled={backupBusy} onClick={() => void confirmReplaceRestore()}>{backupBusy ? "正在替换…" : "确认替换全部数据"}</button></div></>
            : modal === "delete" ? <><p className="lm-dialog-copy">删除「{selected?.name}」及其中的所有词条和练习记录。此操作无法撤销。</p><div className="lm-dialog-actions"><button className="lm-button lm-button-secondary" onClick={closeModal}>保留词库</button><button className="lm-button lm-button-danger" onClick={confirmDelete}><Trash2 size={16} /> 删除词库</button></div></> : <><label className="lm-field-label" htmlFor="library-name">词库名称</label><input id="library-name" className="lm-text-input" autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitName(); }} placeholder="例如：旅行英语" />{error && <p className="lm-form-error">{error}</p>}<div className="lm-dialog-actions"><button className="lm-button lm-button-secondary" onClick={closeModal}>取消</button><button className="lm-button lm-button-primary" onClick={() => void submitName()}>{modal === "create" ? "创建词库" : "保存名称"}</button></div></>}
        </Dialog>}
      </AnimatePresence>
    </section>
  );
}

interface ImportScreenProps {
  parseFile: (file: File, options?: ImportOptions) => Promise<ParsedImport>;
  onCreateLibrary: (name: string, words: WordPairDraft[]) => Promise<void>;
  replaceLibraryId: string;
  replaceLibrary?: WordLibrary;
  onReplaceLibrary: (libraryId: string, words: WordPairDraft[]) => Promise<void>;
  onCancel: () => void;
  onComplete: () => void;
}

function ImportScreen({ parseFile, onCreateLibrary, replaceLibraryId, replaceLibrary, onReplaceLibrary, onCancel, onComplete }: ImportScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const parseRequestId = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [rows, setRows] = useState<WordPairDraft[]>([]);
  const [libraryName, setLibraryName] = useState("");
  const [delimiter, setDelimiter] = useState<Delimiter>("auto");
  const [hasHeader, setHasHeader] = useState<boolean | undefined>(undefined);
  const [sheetName, setSheetName] = useState("");
  const [englishColumn, setEnglishColumn] = useState<number | undefined>();
  const [chineseColumn, setChineseColumn] = useState<number | undefined>();
  const [excludeDuplicates, setExcludeDuplicates] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [parseOptions, setParseOptions] = useState<ImportOptions>({ delimiter: "auto" });
  const [previewQuery, setPreviewQuery] = useState(() => {
    try { return window.sessionStorage.getItem("lingmatch-import-preview-query-v5") ?? ""; } catch { return ""; }
  });
  const [previewFilter, setPreviewFilter] = useState<ImportPreviewFilter>(() => {
    try {
      const saved = window.sessionStorage.getItem("lingmatch-import-preview-filter-v5");
      return saved === "abnormal" || saved === "incomplete" || saved === "duplicate" || saved === "suspicious" ? saved : "all";
    } catch { return "all"; }
  });
  const [previewPage, setPreviewPage] = useState(() => {
    try { const saved = Number(window.sessionStorage.getItem("lingmatch-import-preview-page-v5")); return Number.isInteger(saved) && saved > 0 ? saved : 1; } catch { return 1; }
  });
  const replacing = Boolean(replaceLibraryId);

  useEffect(() => {
    if (replaceLibrary) setLibraryName(replaceLibrary.name);
  }, [replaceLibrary]);

  const runParse = async (nextFile: File, options: ImportOptions = {}) => {
    const requestId = ++parseRequestId.current;
    setParsing(true); setError(""); setParsed(null); setRows([]);
    try {
      const result = await parseFile(nextFile, options);
      if (requestId !== parseRequestId.current) return;
      setParsed(result);
      setRows(buildPreviewRows(result, options));
      setLibraryName((current) => current || nextFile.name.replace(/\.[^.]+$/, ""));
      setSheetName(options.sheetName ?? "");
      setEnglishColumn(options.englishColumn ?? result.suggestedEnglishColumn ?? result.columns?.[0]?.index);
      setChineseColumn(options.chineseColumn ?? result.suggestedChineseColumn ?? result.columns?.[1]?.index);
      setHasHeader(options.hasHeader ?? result.hasHeader);
      setParseOptions(options);
    } catch (cause) {
      if (requestId !== parseRequestId.current) return;
      setError(cause instanceof Error ? cause.message : "无法读取这个文件，请确认文件格式和内容。");
      setFile(null); setParsed(null); setRows([]);
    } finally {
      if (requestId === parseRequestId.current) setParsing(false);
    }
  };

  const acceptFile = (nextFile?: File) => {
    if (!nextFile) return;
    const allowed = /\.(csv|xlsx?|json|txt|pdf)$/i.test(nextFile.name);
    if (!allowed) { setFile(null); setParsed(null); setRows([]); setError("请选 CSV、XLSX、XLS、JSON、TXT 或 PDF 文件。"); return; }
    setFile(nextFile); setParsed(null); setRows([]); setLibraryName(nextFile.name.replace(/\.[^.]+$/, ""));
    const isText = /\.txt$/i.test(nextFile.name);
    const initialOptions: ImportOptions = { delimiter: isText ? "auto" : undefined };
    void runParse(nextFile, initialOptions);
  };

  const reparse = (options: ImportOptions) => {
    if (!file) return;
    void runParse(file, options);
  };

  const chooseAnotherFile = () => {
    parseRequestId.current += 1;
    setParsing(false); setFile(null); setParsed(null); setRows([]); setError("");
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  };

  const chooseColumns = (nextEnglish: number, nextChinese: number) => {
    setEnglishColumn(nextEnglish); setChineseColumn(nextChinese);
    reparse({ ...parseOptions, sheetName: sheetName || undefined, englishColumn: nextEnglish, chineseColumn: nextChinese });
  };

  const duplicateIndexes = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<number>();
    rows.forEach((row, index) => {
      const key = `${row.english.trim().toLocaleLowerCase()}\u0000${row.chinese.trim()}`;
      if (row.english.trim() && row.chinese.trim() && seen.has(key)) duplicates.add(index);
      if (row.english.trim() && row.chinese.trim()) seen.add(key);
    });
    return duplicates;
  }, [rows]);
  const emptyCount = rows.filter((row) => !row.english.trim() || !row.chinese.trim()).length;
  const suspiciousIndexes = useMemo(() => new Set(rows.flatMap((row, index) => {
    const englishLooksChinese = /[\u3400-\u9fff]/u.test(row.english) && !/[A-Za-z]/.test(row.english);
    const chineseLooksEnglish = /[A-Za-z]/.test(row.chinese) && !/[\u3400-\u9fff]/u.test(row.chinese);
    return englishLooksChinese || chineseLooksEnglish ? [index] : [];
  })), [rows]);
  const filteredPreviewRows = useMemo(() => {
    const normalized = previewQuery.trim().toLocaleLowerCase();
    return rows.flatMap((row, index) => {
      const empty = !row.english.trim() || !row.chinese.trim();
      const duplicate = duplicateIndexes.has(index);
      const suspicious = suspiciousIndexes.has(index);
      const matchesQuery = !normalized || row.english.toLocaleLowerCase().includes(normalized) || row.chinese.toLocaleLowerCase().includes(normalized);
      const matchesFilter = previewFilter === "all"
        || (previewFilter === "abnormal" && (empty || duplicate || suspicious))
        || (previewFilter === "incomplete" && empty)
        || (previewFilter === "duplicate" && duplicate)
        || (previewFilter === "suspicious" && suspicious);
      return matchesQuery && matchesFilter ? [{ row, index }] : [];
    });
  }, [rows, previewQuery, previewFilter, duplicateIndexes, suspiciousIndexes]);
  const previewPageCount = Math.max(1, Math.ceil(filteredPreviewRows.length / LIBRARY_PAGE_SIZE));
  const currentPreviewPage = Math.min(previewPage, previewPageCount);
  const pagedPreviewRows = filteredPreviewRows.slice((currentPreviewPage - 1) * LIBRARY_PAGE_SIZE, currentPreviewPage * LIBRARY_PAGE_SIZE);

  useEffect(() => {
    try {
      window.sessionStorage.setItem("lingmatch-import-preview-query-v5", previewQuery);
      window.sessionStorage.setItem("lingmatch-import-preview-filter-v5", previewFilter);
      window.sessionStorage.setItem("lingmatch-import-preview-page-v5", String(currentPreviewPage));
    } catch { /* Keep the preview usable when WebView storage is unavailable. */ }
  }, [previewQuery, previewFilter, currentPreviewPage]);
  useEffect(() => {
    if (previewPage > previewPageCount) setPreviewPage(previewPageCount);
  }, [previewPage, previewPageCount]);
  const readyRows = rows.filter((row, index) => row.english.trim() && row.chinese.trim() && (!excludeDuplicates || !duplicateIndexes.has(index)));

  const changePreviewQuery = (value: string) => { setPreviewQuery(value); setPreviewPage(1); };
  const changePreviewFilter = (value: ImportPreviewFilter) => { setPreviewFilter(value); setPreviewPage(1); };

  const updateRow = (index: number, side: keyof WordPairDraft, value: string) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [side]: value } : row));
  };
  const removeRow = (index: number) => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  const addRow = () => setRows((current) => [...current, { english: "", chinese: "" }]);

  const submitImport = async () => {
    const name = libraryName.trim();
    if (!replacing && !name) { setError("先给新词库起个名字。"); return; }
    if (replacing && !replaceLibrary) { setError("找不到要替换的词库，请返回词库列表后重试。"); return; }
    if (readyRows.length === 0) { setError("至少需要一条完整的中英词条。"); return; }
    setSaving(true); setError("");
    try {
      const cleanRows = readyRows.map((row) => ({ english: row.english.trim(), chinese: row.chinese.trim() }));
      if (replacing && replaceLibrary) await onReplaceLibrary(replaceLibrary.id, cleanRows);
      else await onCreateLibrary(name, cleanRows);
      onComplete();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败，原词库没有改变。请再试一次。"); }
    finally { setSaving(false); }
  };

  const isSpreadsheet = parsed?.format === "xls" || parsed?.format === "xlsx";
  return (
    <section className="lm-import-page">
      <div className="lm-page-heading">
        <button className="lm-back-link" onClick={parsed || file || error ? chooseAnotherFile : onCancel}><ChevronLeft size={17} /> {parsed ? "更换文件" : file || error ? "重新选择文件" : "返回首页"}</button>
        <div className="lm-page-heading-row"><div><span className="lm-eyebrow">你的词表，只在这台设备上处理</span><h1>{replacing ? "替换词表" : "导入词库"}</h1><p>{replacing ? `检查新文件后，替换「${replaceLibrary?.name}」中的词条。` : "选一份文件，检查识别结果，再保存到本地。"}</p></div><span className="lm-local-badge"><span /> 本地处理</span></div>
      </div>

      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.json,.txt,.pdf" className="sr-only" onChange={(event) => { acceptFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />

      {!file && (
        <div className="lm-import-start">
          <button className={`lm-drop-zone ${dragging ? "is-dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files[0]); }}>
            <span className="lm-upload-mark"><Upload size={22} /></span><strong>拖放文件到这里</strong><span>或者点击选择文件</span><small>CSV · XLSX · XLS · JSON · TXT · 文本型 PDF</small>
          </button>
          <div className="lm-import-formats"><h3>文件里的词条可以这样排列</h3><div className="lm-format-examples"><div><FileSpreadsheet size={17} /><span><strong>表格 / CSV</strong><small>English, Chinese</small></span></div><div><FileText size={17} /><span><strong>TXT</strong><small>Apple | 苹果</small></span></div><div><Braces size={17} /><span><strong>JSON</strong><small>english / chinese</small></span></div></div></div>
        </div>
      )}

      {file && <>
        <div className="lm-import-file-bar"><span className="lm-file-icon">{parsed?.format === "pdf" ? <FileText size={18} /> : parsed?.format === "json" ? <Braces size={18} /> : <FileSpreadsheet size={18} />}</span><span className="lm-file-name"><strong>{file.name}</strong><small>{parsing ? "正在本地读取…" : parsed ? `${rows.length} 行 · ${parsed.format.toUpperCase()}` : "等待解析"}</small></span>{parsing && <span className="lm-spinner" aria-label="正在解析" />}</div>

        {parsing && <div className="lm-loading-state">正在本地解析文件，请稍候…</div>}

        {!parsing && parsed && <>
          {(parsed.format === "txt" || parsed.format === "csv") && (
            <div className="lm-parse-options">
              <label>分隔符<select value={delimiter} onChange={(event) => { const next = event.target.value as Delimiter; setDelimiter(next); reparse({ ...parseOptions, delimiter: next, hasHeader }); }}><option value="auto">自动识别</option><option value="tab">Tab</option><option value="comma">英文逗号</option><option value="chineseComma">中文逗号</option><option value="pipe">竖线 |</option><option value="colon">冒号</option><option value="semicolon">分号</option></select></label>
              {(parsed.format === "csv" || parsed.format === "txt" || isSpreadsheet) && <label className="lm-checkbox-label"><input type="checkbox" checked={hasHeader ?? parsed.hasHeader} onChange={(event) => { const next = event.target.checked; setHasHeader(next); reparse({ ...parseOptions, delimiter, hasHeader: next, sheetName: sheetName || undefined, englishColumn, chineseColumn }); }} /> 第一行是表头</label>}
            </div>
          )}
          {isSpreadsheet && (parsed.sheetNames?.length ?? 0) > 0 && <div className="lm-parse-options"><label>工作表<select value={sheetName || parsed.sheetNames?.[0]} onChange={(event) => { setSheetName(event.target.value); reparse({ ...parseOptions, sheetName: event.target.value, englishColumn, chineseColumn }); }}>{parsed.sheetNames?.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label></div>}
          {(isSpreadsheet || parsed.format === "csv") && parsed.columns && parsed.columns.length > 0 && <div className="lm-column-map"><div><strong>确认对应列</strong><small>自动识别后仍可手动调整</small></div><label>英文列<select value={englishColumn ?? ""} onChange={(event) => chooseColumns(Number(event.target.value), chineseColumn ?? parsed.columns![1]?.index ?? 1)}>{parsed.columns.map((column) => <option key={column.index} value={column.index}>{column.label}</option>)}</select></label><label>中文列<select value={chineseColumn ?? ""} onChange={(event) => chooseColumns(englishColumn ?? parsed.columns![0]?.index ?? 0, Number(event.target.value))}>{parsed.columns.map((column) => <option key={column.index} value={column.index}>{column.label}</option>)}</select></label></div>}

          {parsed.warnings.length > 0 && <div className="lm-import-warning" role="status"><CircleHelp size={17} /><div>{parsed.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
          {parsed.format === "pdf" && rows.length === 0 && <div className="lm-import-warning"><FileText size={17} /><p>没有提取到可用的文字。扫描版 PDF 需要 OCR；当前版本不包含 OCR，请换用文本型 PDF 或 CSV/TXT。</p></div>}

          <div className="lm-import-review">
          <div className="lm-import-review-head"><div><span className="lm-eyebrow">确认后再保存</span><h2>检查词条</h2><p className="lm-import-audit">来源 {parsed.sourceRows?.length ?? parsed.words.length} 行 · 预览保留 {rows.length} 条 · 疑似错配 {suspiciousIndexes.size} 条</p></div><span className="lm-review-count"><strong>{readyRows.length}</strong> 条可导入{duplicateIndexes.size > 0 && <em> · {duplicateIndexes.size} 条重复</em>}{emptyCount > 0 && <em> · {emptyCount} 条待补全</em>}{suspiciousIndexes.size > 0 && <em> · {suspiciousIndexes.size} 条疑似错配</em>}</span></div>
            {replacing ? <div className="lm-replace-notice"><RefreshCw size={16} /><span><strong>替换词库内容</strong><small>现有 {replaceLibrary?.wordCount ?? 0} 个词条会被替换，词库名称和练习记录保留。</small></span></div> : <><label className="lm-field-label" htmlFor="import-library-name">新词库名称</label><input id="import-library-name" className="lm-text-input lm-import-name" value={libraryName} onChange={(event) => setLibraryName(event.target.value)} maxLength={60} /></>}
            <div className="lm-import-preview-tools" aria-label="筛选导入预览">
              <label className="lm-search"><Search size={17} /><input value={previewQuery} onChange={(event) => changePreviewQuery(event.target.value)} placeholder="搜索英文或中文释义" aria-label="搜索预览中的英文或中文" /></label>
              <label className="lm-preview-filter-label">显示<select aria-label="筛选导入异常" value={previewFilter} onChange={(event) => changePreviewFilter(event.target.value as ImportPreviewFilter)}>
                <option value="all">全部词条</option><option value="abnormal">所有异常</option><option value="incomplete">缺少内容</option><option value="duplicate">重复词条</option><option value="suspicious">疑似错配</option>
              </select></label>
              <span className="lm-preview-filter-count">显示 {filteredPreviewRows.length} / {rows.length} 条</span>
            </div>
            <div className="lm-preview-table-wrap" id="lm-preview-table-wrap">
              <div className="lm-preview-header"><span>英文</span><span>中文释义</span><span className="sr-only">操作</span></div>
              <div className="lm-preview-body">{pagedPreviewRows.map(({ row, index }) => {
                const empty = !row.english.trim() || !row.chinese.trim();
                const duplicate = duplicateIndexes.has(index);
                const suspicious = suspiciousIndexes.has(index);
                return <div className={`lm-preview-row ${empty ? "is-incomplete" : ""} ${duplicate ? "is-duplicate" : ""} ${suspicious ? "is-suspicious" : ""}`} key={index}>
                  <input aria-label={`第 ${index + 1} 行英文`} value={row.english} onChange={(event) => updateRow(index, "english", event.target.value)} placeholder="English" />
                  <input aria-label={`第 ${index + 1} 行中文`} value={row.chinese} onChange={(event) => updateRow(index, "chinese", event.target.value)} placeholder="中文释义" />
                  <span className="lm-row-status">{duplicate ? <span className="lm-duplicate-tag">重复</span> : empty ? <span className="lm-incomplete-tag">待补</span> : suspicious ? <span className="lm-incomplete-tag">核对</span> : null}<button className="lm-icon-button" aria-label={`明确删除第 ${index + 1} 行`} onClick={() => removeRow(index)}><X size={15} /></button></span>
                </div>;
              })}{pagedPreviewRows.length === 0 && <div className="lm-loading-state">没有符合条件的词条。</div>}</div>
              <button className="lm-add-row" onClick={addRow}><Plus size={16} /> 添加一行</button>
            </div>
            {filteredPreviewRows.length > 0 && <Pager page={currentPreviewPage} pageSize={LIBRARY_PAGE_SIZE} total={filteredPreviewRows.length} onPageChange={setPreviewPage} scrollTargetId="lm-preview-table-wrap" label="导入预览分页" />}
            {duplicateIndexes.size > 0 && <label className="lm-checkbox-label lm-duplicate-toggle"><input type="checkbox" checked={excludeDuplicates} onChange={(event) => setExcludeDuplicates(event.target.checked)} /> 明确排除重复词条（默认保留）</label>}
            {emptyCount > 0 && <p className="lm-import-blocking-note">还有 {emptyCount} 条词目缺少内容。请补齐，或逐条点 × 明确删除后再导入。</p>}
            {error && <div className="lm-form-error lm-import-error" role="alert">{error}</div>}
            <div className="lm-import-footer"><span><CheckCircle2 size={16} /> 文件只在本地处理，不会上传</span><button className="lm-button lm-button-primary" disabled={saving || readyRows.length === 0 || emptyCount > 0} onClick={() => void submitImport()}>{saving ? "正在保存…" : replacing ? `确认替换 ${readyRows.length} 条` : `确认导入 ${readyRows.length} 条`}<ChevronRight size={17} /></button></div>
          </div>
        </>}
      </>}
      {error && !parsed && <div className="lm-import-error lm-parse-failure" role="alert"><span>{error} 你可以直接重新选择文件。</span><button className="lm-text-button" onClick={chooseAnotherFile}>重新选择文件</button></div>}
    </section>
  );
}

interface MatchGameProps {
  library: WordLibrary;
  entries: WordEntry[];
  task: StudyTask;
  settings: GameSettings;
  onExit: () => void;
  onRecordPairResolution(input: { taskId: string; roundNumber: number; englishWordId: string; chineseWordId: string; correct: boolean }): Promise<StudyTask>;
  onFinish: (durationSeconds: number) => Promise<CompletedRoundResult>;
  onReplay: () => void;
}

function MatchGame({ library, entries, task, settings, onExit, onRecordPairResolution, onFinish, onReplay }: MatchGameProps) {
  const shouldReduceMotion = useReducedMotion();
  const round = useMemo(() => prepareMatchRound(entries, entries.length), [entries, task.id, task.roundNumber]);
  const [selectedEnglish, setSelectedEnglish] = useState<string | null>(null);
  const [selectedChinese, setSelectedChinese] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(() => new Set(task.currentMatchedWordIds));
  const [errorIds, setErrorIds] = useState<Set<string>>(() => new Set());
  const [locked, setLocked] = useState(false);
  const [wordMisses, setWordMisses] = useState<Record<string, number>>(() => ({ ...task.mistakesByWord }));
  const [elapsed, setElapsed] = useState(0);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savingRound, setSavingRound] = useState(false);
  const [completedTask, setCompletedTask] = useState<CompletedRoundResult | undefined>();
  const startAt = useRef(Date.now());
  const autoSaveStarted = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const animationTimer = useRef<number | null>(null);
  const remainingEnglish = useMemo(() => round.english.filter((card) => !matched.has(card.wordId)), [matched, round.english]);
  const remainingChinese = useMemo(() => round.chinese.filter((card) => !matched.has(card.wordId)), [matched, round.chinese]);
  const totalMisses = Object.values(wordMisses).reduce((sum, value) => sum + value, 0);
  const mistakes = Math.ceil(totalMisses / 2);
  const allMatched = round.words.length > 0 && matched.size === round.words.length;

  useEffect(() => {
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - startAt.current) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const playTone = (success: boolean) => {
    if (!settings.soundEnabled) return;
    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) return;
      audioRef.current ??= new AudioContextConstructor();
      const context = audioRef.current;
      if (context.state === "suspended") void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = success ? 660 : 230;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (success ? 0.12 : 0.18));
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.2);
    } catch { /* Audio is optional and may be unavailable in a browser context. */ }
  };

  const vibrate = (duration: number) => {
    if (settings.vibrationEnabled && "vibrate" in navigator) navigator.vibrate(duration);
  };

  const handleSelect = (card: MatchCardItem) => {
    if (locked || matched.has(card.wordId)) return;
    if (card.side === "english") {
      if (selectedEnglish === card.wordId) { setSelectedEnglish(null); return; }
      setSelectedEnglish((current) => current === card.wordId ? null : card.wordId);
      if (selectedChinese) resolvePair(card.wordId, selectedChinese);
      return;
    }
    if (selectedChinese === card.wordId) { setSelectedChinese(null); return; }
    setSelectedChinese((current) => current === card.wordId ? null : card.wordId);
    if (selectedEnglish) resolvePair(selectedEnglish, card.wordId);
  };

  const resolvePair = async (englishId: string, chineseId: string) => {
    if (locked || !englishId || !chineseId) return;
    setLocked(true);
    setSaveError("");
    const correct = englishId === chineseId;
    try {
      await onRecordPairResolution({ taskId: task.id, roundNumber: task.roundNumber, englishWordId: englishId, chineseWordId: chineseId, correct });
      if (correct) {
        playTone(true); vibrate(18);
        animationTimer.current = window.setTimeout(() => {
          setMatched((current) => new Set(current).add(englishId));
          setSelectedEnglish(null); setSelectedChinese(null); setLocked(false);
        }, shouldReduceMotion ? 0 : 360);
      } else {
        playTone(false); vibrate(35);
        setWordMisses((current) => ({ ...current, [englishId]: (current[englishId] ?? 0) + 1, [chineseId]: (current[chineseId] ?? 0) + 1 }));
        setErrorIds(new Set([englishId, chineseId]));
        animationTimer.current = window.setTimeout(() => {
          setErrorIds(new Set()); setSelectedEnglish(null); setSelectedChinese(null); setLocked(false);
        }, shouldReduceMotion ? 0 : 460);
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "本次配对没有保存，请再试一次。");
      setSelectedEnglish(null); setSelectedChinese(null); setLocked(false);
    }
  };

  const finishRound = async () => {
    if (!allMatched || autoSaveStarted.current || savingRound) return;
    autoSaveStarted.current = true;
    setSavingRound(true);
    setSaveError("");
    try {
      const result = await onFinish(Math.floor((Date.now() - startAt.current) / 1000));
      if (result.task.status === "completed") setCompletedTask(result);
    } catch (cause) {
      autoSaveStarted.current = false;
      setSaveError(cause instanceof Error ? cause.message : "本轮完成了，但保存记录失败。请再试一次。");
    } finally {
      setSavingRound(false);
    }
  };

  useEffect(() => {
    if (allMatched && !autoSaveStarted.current) void finishRound();
  }, [allMatched]);

  useEffect(() => () => {
    if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
    void audioRef.current?.close();
  }, []);

  const progress = round.words.length ? matched.size / round.words.length : 0;
  if (!round.words.length) return <div className="lm-game-empty"><button className="lm-back-link" onClick={onExit}><ChevronLeft size={17} /> 返回</button><h2>这个词库还没有词条</h2><p>添加一些中英词条后，马上开始配对。</p></div>;
  if (completedTask) {
    const finished = completedTask.task;
    const taskAccuracy = finished.plannedWordIds.length + finished.totalMistakes === 0
      ? 100
      : Math.round((finished.plannedWordIds.length / (finished.plannedWordIds.length + finished.totalMistakes)) * 100);
    return <div className="lm-game-wrap">
      <header className="lm-game-header"><button className="lm-icon-button lm-game-exit" aria-label="返回首页" onClick={onExit}><ArrowLeft size={19} /></button><div className="lm-game-heading"><span>{library.name}</span><strong>学习任务</strong></div><span className="lm-pair-count">已完成</span></header>
      <div className="lm-game-content"><section className="lm-game-complete" aria-live="polite">
        <div className="lm-win-confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <motion.div className="lm-win-icon" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 210, damping: 16 }}><Trophy size={34} /></motion.div>
        <span className="lm-eyebrow">学习任务完成</span><h1>今天的学习完成了。</h1><p>系统已根据本次配对表现自动更新学习进度和复习时间。</p>
        <div className="lm-win-stats"><div><strong>{finished.completedWordIds.length}</strong><span>计划词条</span></div><div><strong>{finished.roundNumber}</strong><span>练习轮次</span></div><div><strong>{formatDuration(finished.durationSeconds)}</strong><span>学习时长</span></div></div>
        <div className="lm-win-performance"><Sparkles size={17} />累计配对准确率 {taskAccuracy}% · {finished.totalMistakes} 次错配</div>
        {saveError && <p className="lm-form-error" role="alert">{saveError}</p>}
        <div className="lm-win-actions"><button className="lm-button lm-button-primary" onClick={() => void onReplay()}><RotateCw size={17} /> 再练一组</button><button className="lm-button lm-button-secondary" onClick={onExit}>返回首页</button></div>
      </section></div>
    </div>;
  }

  return (
    <div className="lm-game-wrap">
      <header className="lm-game-header">
        <button className="lm-icon-button lm-game-exit" aria-label="退出本轮" onClick={() => setExitConfirm(true)}><ArrowLeft size={19} /></button>
        <div className="lm-game-heading"><span>{library.name}</span><strong>中英配对</strong></div>
        <div className="lm-game-meta">{settings.timerEnabled && <span className="lm-timer-pill"><Clock3 size={15} /> {formatDuration(elapsed)}</span>}<span className="lm-pair-count"><strong>{matched.size}</strong> / {round.words.length}</span></div>
      </header>
      <div className="lm-game-progress"><div style={{ width: `${progress * 100}%` }} /></div>
      <div className="lm-game-content">
        {allMatched ? (
          <section className="lm-round-autosave" aria-live="polite">
            <span className="lm-autosave-mark"><CheckCircle2 size={25} /></span>
            <span className="lm-eyebrow">这一轮配对完成</span>
            <h1>{savingRound ? "正在保存本轮表现…" : saveError ? "本轮记录尚未保存" : "本轮表现已自动记录"}</h1>
            <p>{round.words.length} 个词条 · 错配 {mistakes} 次。系统会结合错配次数和既往练习安排下次复习，不需要逐词评价。</p>
            {saveError ? <><p className="lm-form-error" role="alert">{saveError}</p><button className="lm-button lm-button-primary" disabled={savingRound} onClick={() => { autoSaveStarted.current = false; void finishRound(); }}>{savingRound ? "正在保存…" : "重试保存"}<RotateCw size={16} /></button></> : <small>{savingRound ? "请稍候，保存完成后会自动进入下一轮。" : "保存完成后将自动进入下一轮。"}</small>}
          </section>
        ) : (
          <>
            <div className="lm-game-instructions"><span className="lm-game-step"><span>任务第 {task.roundNumber} 轮</span><strong>{matched.size} / {round.words.length}</strong></span><div><h1>找到相配的词。</h1><p>依次点击英文和对应的中文释义</p></div><span className="lm-game-remaining">还剩 <strong>{round.words.length - matched.size}</strong> 对</span></div>
            <div className="lm-match-board" role="group" aria-label="中英配对棋盘">
              <div className="lm-column-heading">ENGLISH</div><div className="lm-column-heading lm-heading-divider" aria-hidden="true">⇄</div><div className="lm-column-heading">中文释义</div>
              <AnimatePresence initial={false}>{remainingEnglish.map((englishCard, index) => {
                const chineseCard = remainingChinese[index];
                if (!chineseCard) return null;
                return <motion.div className="lm-match-row" key={`${englishCard.wordId}:${chineseCard.wordId}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: shouldReduceMotion ? 0 : 0.22, layout: { type: "spring", stiffness: 300, damping: 28 } }}>
                  <MatchCard card={englishCard} selected={selectedEnglish === englishCard.wordId} error={errorIds.has(englishCard.wordId)} locked={locked} onSelect={handleSelect} />
                  <div className="lm-row-divider" aria-hidden="true"><span>·</span></div>
                  <MatchCard card={chineseCard} selected={selectedChinese === chineseCard.wordId} error={errorIds.has(chineseCard.wordId)} locked={locked} onSelect={handleSelect} />
                </motion.div>;
              })}</AnimatePresence>
            </div>
            <div className="lm-game-footer"><span><span className="lm-footer-dot" />{matched.size === 0 ? "慢慢找，第一对就在眼前" : `已经配好 ${matched.size} 对`}{mistakes > 0 && ` · 错配 ${mistakes} 次`}</span>{settings.timerEnabled && <span className="lm-footer-time"><Timer size={15} /> {formatDuration(elapsed)}</span>}</div>
          </>
        )}
      </div>
      <AnimatePresence>{exitConfirm && <Dialog title="暂时离开？" onClose={() => setExitConfirm(false)}><p className="lm-dialog-copy">当前已配对词条和错配次数会自动保存，之后可以从首页继续这一轮。</p><div className="lm-dialog-actions"><button className="lm-button lm-button-secondary" onClick={() => setExitConfirm(false)}>继续配对</button><button className="lm-button lm-button-danger" onClick={onExit}><ArrowLeft size={16} /> 保存并返回</button></div></Dialog>}</AnimatePresence>
    </div>
  );
}

function MatchCard({ card, selected, error, locked, onSelect }: { card: MatchCardItem; selected: boolean; error: boolean; locked: boolean; onSelect: (card: MatchCardItem) => void }) {
  const shouldReduceMotion = useReducedMotion();
  return <motion.button
    layout
    animate={{ x: error ? [0, -6, 6, -4, 4, 0] : 0 }}
    transition={{ duration: shouldReduceMotion ? 0 : 0.22, layout: { type: "spring", stiffness: 300, damping: 28 } }}
    className={`lm-match-card ${selected ? "is-selected" : ""} ${error ? "is-error" : ""}`}
    disabled={locked}
    aria-pressed={selected}
    onClick={() => onSelect(card)}
  ><span>{card.label}</span></motion.button>;
}

interface SettingsDialogProps {
  settings: GameSettings;
  theme: Theme;
  onThemeChange: (theme: Theme) => Promise<void>;
  onSave: (settings: GameSettings) => Promise<void>;
  onClose: () => void;
}

function SettingsDialog({ settings, theme, onThemeChange, onSave, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<GameSettings>(settings ?? DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(settings ?? DEFAULT_SETTINGS), [settings]);
  const update = (key: keyof GameSettings, value: GameSettings[keyof GameSettings]) => setDraft((current) => ({ ...current, [key]: value } as GameSettings));
  const submit = async () => {
    setSaving(true); setError("");
    try { await onSave(draft); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "设置保存失败。"); }
    finally { setSaving(false); }
  };
  return <Dialog title="配对设置" onClose={onClose} className="lm-settings-dialog">
    <p className="lm-dialog-copy">调整一轮的节奏和界面偏好。</p>
    <fieldset className="lm-pairs-setting"><legend>每轮配对数量</legend><div>{([4, 6, 8, 10, 12] as const).map((count) => <button key={count} className={draft.pairsPerRound === count ? "is-selected" : ""} aria-pressed={draft.pairsPerRound === count} onClick={() => update("pairsPerRound", count)}>{count}</button>)}</div></fieldset>
    <div className="lm-setting-list">
      <SettingToggle icon={draft.timerEnabled ? <Clock3 size={18} /> : <Timer size={18} />} title="显示计时器" description="查看这一轮用了多久" checked={draft.timerEnabled} onChange={(checked) => update("timerEnabled", checked)} />
      <SettingToggle icon={draft.soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />} title="配对音效" description="成功和错误时播放轻提示" checked={draft.soundEnabled} onChange={(checked) => update("soundEnabled", checked)} />
      <SettingToggle icon={<Vibrate size={18} />} title="震动反馈" description="设备支持时轻微震动" checked={draft.vibrationEnabled} onChange={(checked) => update("vibrationEnabled", checked)} />
      <div className="lm-setting-row"><span className="lm-setting-icon">{theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}</span><span className="lm-setting-copy"><strong>外观</strong><small>浅色或深色界面</small></span><button className="lm-theme-switch" aria-label={theme === "dark" ? "切换浅色界面" : "切换深色界面"} onClick={() => void onThemeChange(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "深色" : "浅色"}<ChevronDown size={14} /></button></div>
    </div>
    {error && <p className="lm-form-error" role="alert">{error}</p>}
    <div className="lm-dialog-actions"><button className="lm-button lm-button-secondary" onClick={onClose}>取消</button><button className="lm-button lm-button-primary" disabled={saving} onClick={() => void submit()}>{saving ? "保存中…" : "保存设置"}</button></div>
  </Dialog>;
}

function SettingToggle({ icon, title, description, checked, onChange }: { icon: ReactNode; title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="lm-setting-row"><span className="lm-setting-icon">{icon}</span><span className="lm-setting-copy"><strong>{title}</strong><small>{description}</small></span><input className="lm-switch-input" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function Dialog({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const shouldReduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <motion.div className="lm-modal-backdrop" initial={shouldReduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={shouldReduceMotion ? undefined : { opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.div ref={dialogRef} className={`lm-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby="lm-dialog-title" tabIndex={-1} initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={shouldReduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}>
      <div className="lm-dialog-title-row"><h2 id="lm-dialog-title">{title}</h2><button className="lm-icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>{children}
    </motion.div>
  </motion.div>;
}

function MobileNavigation({ screen, onScreenChange, onImport }: { screen: Screen; onScreenChange: (screen: Screen) => void; onImport: () => void }) {
  return <nav className="lm-mobile-nav" aria-label="底部导航">
    <button className={screen === "home" ? "is-active" : ""} onClick={() => onScreenChange("home")}><Gamepad2 size={19} /><span>首页</span></button>
    <button className={screen === "import" ? "is-active" : ""} onClick={onImport}><Upload size={19} /><span>导入</span></button>
    <button className={screen === "library" ? "is-active" : ""} onClick={() => onScreenChange("library")}><Library size={19} /><span>词库</span></button>
  </nav>;
}
