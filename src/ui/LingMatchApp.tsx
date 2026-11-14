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
  LearningStats,
  GameResult,
  GameSettings,
  ImportOptions,
  ParsedImport,
  PairCount,
  ReviewRating,
  StudyTask,
  StudyTaskMode,
  WordEntry,
  WordLearningProfile,
  WordLearningStatus,
  WordLibrary,
  WordPairDraft,
} from "../types/domain";
import type { CompletedRoundResult, StudyTaskBundle } from "../features/learning/learningService";
import { LEARNING_STATUS_LABELS } from "../features/learning/learningEngine";
import { prepareMatchRound, type MatchCardItem } from "../features/matching/matchingEngine";
import "./lingmatch.css";

type Screen = "home" | "library" | "import" | "game";
type Theme = "light" | "dark";
type Delimiter = NonNullable<ImportOptions["delimiter"]>;

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
  saveResult(result: GameResult): Promise<void>;
  createStudyTask(libraryId: string, mode: StudyTaskMode, roundSize: PairCount, targetCount?: number): Promise<StudyTaskBundle>;
  resumeStudyTask(taskId: string): Promise<StudyTaskBundle>;
  pauseStudyTask(taskId: string): Promise<void>;
  recordPairResolution(input: { taskId: string; roundNumber: number; englishWordId: string; chineseWordId: string; correct: boolean }): Promise<StudyTask>;
  completeStudyRound(taskId: string, roundNumber: number, ratings: Record<string, ReviewRating>, durationSeconds: number): Promise<CompletedRoundResult>;
  getResumableStudyTask(libraryId?: string): Promise<StudyTask | undefined>;
  getLearningStats(libraryId: string): Promise<LearningStats>;
  getLearningProfiles(libraryId: string): Promise<WordLearningProfile[]>;
  setWordLearningStatus(wordId: string, status: WordLearningStatus): Promise<WordLearningProfile>;
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
  const [resumableTask, setResumableTask] = useState<StudyTask | undefined>();
  const [learningStats, setLearningStats] = useState<LearningStats | undefined>();
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
  const loadLearningStats = props.getLearningStats;
  const loadResumableTask = props.getResumableStudyTask;
  const openImport = (libraryId = "") => { setReplaceTargetId(libraryId); setScreen("import"); };

  useEffect(() => {
    let cancelled = false;
    if (!activeLibrary) {
      setLearningStats(undefined);
      setResumableTask(undefined);
      return;
    }
    void Promise.all([loadLearningStats(activeLibrary.id), loadResumableTask(activeLibrary.id)]).then(([stats, task]) => {
      if (cancelled) return;
      setLearningStats(stats);
      setResumableTask(task?.libraryId === activeLibrary.id ? task : undefined);
    }).catch((cause) => {
      if (!cancelled) setAppError(cause instanceof Error ? cause.message : "暂时无法读取学习进度。");
    });
    return () => { cancelled = true; };
  }, [activeLibrary?.id, screen, loadLearningStats, loadResumableTask]);

  const handleStartGame = useCallback(async (mode: StudyTaskMode = "mixed") => {
    if (!activeLibrary) {
      openImport();
      return;
    }
    setBusy(true);
    setAppError("");
    try {
      const bundle = await props.createStudyTask(activeLibrary.id, mode, props.settings.pairsPerRound, mode === "all" ? activeLibrary.wordCount : 50);
      setStudyTask(bundle.task);
      setResumableTask(bundle.task);
      setGameWords(bundle.words);
      setGameSeed((seed) => seed + 1);
      setScreen("game");
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "读取词库失败，请再试一次。");
    } finally {
      setBusy(false);
    }
  }, [activeLibrary, props]);

  const handleResumeGame = useCallback(async () => {
    if (!resumableTask) return;
    setBusy(true);
    setAppError("");
    try {
      const bundle = await props.resumeStudyTask(resumableTask.id);
      setStudyTask(bundle.task);
      setResumableTask(bundle.task);
      setGameWords(bundle.words);
      setGameSeed((seed) => seed + 1);
      setScreen("game");
    } catch (cause) {
      setAppError(cause instanceof Error ? cause.message : "恢复学习任务失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, [props, resumableTask]);

  const handlePauseGame = useCallback(async () => {
    if (studyTask) await props.pauseStudyTask(studyTask.id);
    setScreen("home");
    setResumableTask(await props.getResumableStudyTask(studyTask?.libraryId));
  }, [props, studyTask]);

  const handleFinishRound = useCallback(async (ratings: Record<string, ReviewRating>, durationSeconds: number) => {
    if (!studyTask) throw new Error("找不到当前学习任务，请返回首页后继续。");
    const result = await props.completeStudyRound(studyTask.id, studyTask.roundNumber, ratings, durationSeconds);
    setStudyTask(result.task);
    setResumableTask(result.task.status === "completed" ? undefined : result.task);
    if (result.task.status !== "completed") {
      setGameWords(result.words);
      setGameSeed((seed) => seed + 1);
    }
    setLearningStats(await props.getLearningStats(result.task.libraryId));
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
                learningStats={learningStats}
                resumableTask={resumableTask}
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
                getLearningProfiles={props.getLearningProfiles}
                onSetWordLearningStatus={props.setWordLearningStatus}
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
  learningStats?: LearningStats;
  resumableTask?: StudyTask;
  busy: boolean;
  onStart: (mode?: StudyTaskMode) => void;
  onResume: () => void;
  onImport: () => void;
  onLibrary: () => void;
  onSelectLibrary: (id: string) => void;
  onOpenSettings: () => void;
}

function HomeScreen({ libraries, activeLibrary, selectedLibraryId, settings, history, learningStats, resumableTask, busy, onStart, onResume, onImport, onLibrary, onSelectLibrary, onOpenSettings }: HomeScreenProps) {
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

      {activeLibrary && learningStats && <section className="lm-study-planner" aria-label="学习计划">
        <div className="lm-section-heading"><div><span className="lm-eyebrow">按记忆状态安排</span><h2>今天学什么？</h2></div><span className="lm-planner-total"><strong>{learningStats.due}</strong> 个待复习</span></div>
        <div className="lm-learning-snapshot">
          <span>未学习 <strong>{learningStats.unlearned}</strong></span><i />
          <span>学习中 <strong>{learningStats.learning}</strong></span><i />
          <span>模糊 <strong>{learningStats.fuzzy}</strong></span><i />
          <span>熟悉 <strong>{learningStats.familiar}</strong></span><i />
          <span>掌握 <strong>{learningStats.mastered}</strong></span>
        </div>
        <div className="lm-study-modes">
          {([
            { mode: "due", title: "今日复习", count: learningStats.due, hint: "已到复习时间" },
            { mode: "wrong", title: "错词强化", count: learningStats.weak, hint: "容易出错的词" },
            { mode: "weak", title: "薄弱词训练", count: learningStats.weak, hint: "优先补足短板" },
            { mode: "new", title: "新词学习", count: learningStats.unlearned, hint: "按计划逐步覆盖" },
            { mode: "mixed", title: "混合练习", count: learningStats.total, hint: "按记忆优先级抽取" },
            { mode: "all", title: "全词库测试", count: learningStats.total, hint: "完整检查整本词库" },
          ] as const).map((item) => <button className="lm-study-mode" key={item.mode} disabled={busy || item.count === 0} onClick={() => onStart(item.mode)}>
            <strong>{item.title}</strong><span>{item.hint}</span><small>{item.count} 词</small>
          </button>)}
        </div>
        {resumableTask && <button className="lm-resume-task" disabled={busy} onClick={onResume}><span><strong>继续上次学习</strong><small>已完成 {resumableTask.completedWordIds.length} / {resumableTask.plannedWordIds.length} 个计划词</small></span><ChevronRight size={18} /></button>}
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

interface LibraryScreenProps {
  libraries: WordLibrary[];
  selectedLibraryId: string;
  listWords: (libraryId: string) => Promise<WordEntry[]>;
  getLearningProfiles: (libraryId: string) => Promise<WordLearningProfile[]>;
  onSetWordLearningStatus: (wordId: string, status: WordLearningStatus) => Promise<WordLearningProfile>;
  onSelect: (id: string) => void;
  onBack: () => void;
  onImport: () => void;
  onReimport: (id: string) => void;
  onCreateLibrary: (name: string, words: WordPairDraft[]) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function LibraryScreen({ libraries, selectedLibraryId, listWords, getLearningProfiles, onSetWordLearningStatus, onSelect, onBack, onImport, onReimport, onCreateLibrary, onRename, onDelete }: LibraryScreenProps) {
  const [entries, setEntries] = useState<WordEntry[]>([]);
  const [learningProfiles, setLearningProfiles] = useState<WordLearningProfile[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<"create" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const selected = libraries.find((library) => library.id === selectedLibraryId);

  useEffect(() => {
    let cancelled = false;
    if (!selectedLibraryId) { setEntries([]); setLearningProfiles([]); return; }
    setLoading(true);
    Promise.all([listWords(selectedLibraryId), getLearningProfiles(selectedLibraryId)])
      .then(([words, profiles]) => { if (!cancelled) { setEntries(words); setLearningProfiles(profiles); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "读取词条失败。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedLibraryId, listWords, getLearningProfiles, libraries]);

  const profileByWordId = useMemo(() => new Map(learningProfiles.map((profile) => [profile.wordId, profile])), [learningProfiles]);

  const handleStatusChange = async (wordId: string, status: WordLearningStatus) => {
    try {
      const updated = await onSetWordLearningStatus(wordId, status);
      setLearningProfiles((current) => [...current.filter((profile) => profile.wordId !== wordId), updated]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存单词状态失败。");
    }
  };

  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return entries;
    return entries.filter((word) => word.english.toLocaleLowerCase().includes(normalized) || word.chinese.includes(query.trim()));
  }, [entries, query]);

  const openRename = () => { setName(selected?.name ?? ""); setError(""); setModal("rename"); };
  const openCreate = () => { setName(""); setError(""); setModal("create"); };
  const closeModal = () => { setModal(null); setError(""); };

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
            <button className={`lm-library-row ${library.id === selectedLibraryId ? "is-selected" : ""}`} key={library.id} onClick={() => { onSelect(library.id); setQuery(""); }}>
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
              <div className="lm-words-toolbar"><div className="lm-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索英文或中文" aria-label="搜索词条" /></div><button className="lm-button lm-button-secondary lm-compact-button" onClick={() => onReimport(selected.id)}><Upload size={16} /> 替换词表</button><button className="lm-button lm-button-secondary lm-compact-button" onClick={onImport}><Plus size={16} /> 新建词库</button></div>
              {loading ? <div className="lm-loading-state">正在读取词条…</div> : entries.length === 0 ? (
                <div className="lm-empty-words"><span><BookOpen size={22} /></span><h3>词库还空着</h3><p>导入一份中英词表，开始你的第一轮配对。</p><button className="lm-button lm-button-primary" onClick={onImport}><Upload size={17} /> 导入词表</button></div>
              ) : visibleEntries.length === 0 ? <div className="lm-loading-state">没有找到匹配的词条。</div> : (
                <div className="lm-word-list-wrap">
                  <div className="lm-word-list-labels"><span>ENGLISH</span><span>中文释义</span><span>学习状态</span></div>
                  <div className="lm-word-list">{visibleEntries.map((word) => <div className="lm-word-row" key={word.id}><span>{word.english}</span><span>{word.chinese}</span><select aria-label={`调整 ${word.english} 的学习状态`} value={profileByWordId.get(word.id)?.status ?? "unlearned"} onChange={(event) => void handleStatusChange(word.id, event.target.value as WordLearningStatus)}>{(Object.entries(LEARNING_STATUS_LABELS) as [WordLearningStatus, string][]).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></div>)}</div>
                  <div className="lm-word-count-note">显示 {visibleEntries.length} / {entries.length} 个词条</div>
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
        {modal && <Dialog onClose={closeModal} title={modal === "create" ? "新建词库" : modal === "rename" ? "重命名词库" : "删除词库？"}>
          {modal === "delete" ? <><p className="lm-dialog-copy">删除「{selected?.name}」及其中的所有词条和练习记录。此操作无法撤销。</p><div className="lm-dialog-actions"><button className="lm-button lm-button-secondary" onClick={closeModal}>保留词库</button><button className="lm-button lm-button-danger" onClick={confirmDelete}><Trash2 size={16} /> 删除词库</button></div></> : <><label className="lm-field-label" htmlFor="library-name">词库名称</label><input id="library-name" className="lm-text-input" autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitName(); }} placeholder="例如：旅行英语" />{error && <p className="lm-form-error">{error}</p>}<div className="lm-dialog-actions"><button className="lm-button lm-button-secondary" onClick={closeModal}>取消</button><button className="lm-button lm-button-primary" onClick={() => void submitName()}>{modal === "create" ? "创建词库" : "保存名称"}</button></div></>}
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
  const readyRows = rows.filter((row, index) => row.english.trim() && row.chinese.trim() && (!excludeDuplicates || !duplicateIndexes.has(index)));

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
            <div className="lm-preview-table-wrap">
              <div className="lm-preview-header"><span>英文</span><span>中文释义</span><span className="sr-only">操作</span></div>
              <div className="lm-preview-body">{rows.map((row, index) => {
                const empty = !row.english.trim() || !row.chinese.trim();
                const duplicate = duplicateIndexes.has(index);
                const suspicious = suspiciousIndexes.has(index);
                return <div className={`lm-preview-row ${empty ? "is-incomplete" : ""} ${duplicate ? "is-duplicate" : ""} ${suspicious ? "is-suspicious" : ""}`} key={index}>
                  <input aria-label={`第 ${index + 1} 行英文`} value={row.english} onChange={(event) => updateRow(index, "english", event.target.value)} placeholder="English" />
                  <input aria-label={`第 ${index + 1} 行中文`} value={row.chinese} onChange={(event) => updateRow(index, "chinese", event.target.value)} placeholder="中文释义" />
                  <span className="lm-row-status">{duplicate ? <span className="lm-duplicate-tag">重复</span> : empty ? <span className="lm-incomplete-tag">待补</span> : suspicious ? <span className="lm-incomplete-tag">核对</span> : null}<button className="lm-icon-button" aria-label={`明确删除第 ${index + 1} 行`} onClick={() => removeRow(index)}><X size={15} /></button></span>
                </div>;
              })}</div>
              <button className="lm-add-row" onClick={addRow}><Plus size={16} /> 添加一行</button>
            </div>
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
  onFinish: (ratings: Record<string, ReviewRating>, durationSeconds: number) => Promise<CompletedRoundResult>;
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
  const [wordMisses, setWordMisses] = useState<Record<string, number>>(() => ({ ...task.currentMissesByWord }));
  const [ratings, setRatings] = useState<Record<string, ReviewRating>>({});
  const [elapsed, setElapsed] = useState(0);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savingRound, setSavingRound] = useState(false);
  const [completedTask, setCompletedTask] = useState<CompletedRoundResult | undefined>();
  const startAt = useRef(Date.now());
  const audioRef = useRef<AudioContext | null>(null);
  const animationTimer = useRef<number | null>(null);
  const remainingEnglish = useMemo(() => round.english.filter((card) => !matched.has(card.wordId)), [matched, round.english]);
  const remainingChinese = useMemo(() => round.chinese.filter((card) => !matched.has(card.wordId)), [matched, round.chinese]);
  const totalMisses = Object.values(wordMisses).reduce((sum, value) => sum + value, 0);
  const mistakes = Math.ceil(totalMisses / 2);
  const allMatched = round.words.length > 0 && matched.size === round.words.length;
  const allRated = round.words.length > 0 && round.words.every((word) => Boolean(ratings[word.id]));

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
    if (!allMatched || !allRated || savingRound) return;
    setSavingRound(true);
    setSaveError("");
    try {
      const result = await onFinish(ratings, Math.floor((Date.now() - startAt.current) / 1000));
      if (result.task.status === "completed") setCompletedTask(result);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "本轮完成了，但保存记录失败。请再试一次。");
    } finally {
      setSavingRound(false);
    }
  };

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
        <span className="lm-eyebrow">学习任务完成</span><h1>今天的学习完成了。</h1><p>每个词条的记忆反馈和下次复习时间都已保存。</p>
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
          <section className="lm-round-feedback" aria-live="polite">
            <div className="lm-feedback-heading"><span className="lm-eyebrow">这一轮配对完成</span><h1>你真的记住了吗？</h1><p>配对正确不一定代表掌握。请按实际记忆为每个词选择一次反馈。</p></div>
            <div className="lm-feedback-list">{round.words.map((word) => <article className="lm-feedback-word" key={word.id}>
              <div className="lm-feedback-definition"><strong>{word.english}</strong><span>{word.chinese}</span>{(wordMisses[word.id] ?? 0) > 0 && <small>本轮错配 {wordMisses[word.id]} 次</small>}</div>
              <div className="lm-rating-options" role="group" aria-label={`对 ${word.english} 的记忆反馈`}>
                {([['forgotten', '忘记了'], ['uncertain', '不太确定'], ['remembered', '记住了']] as const).map(([rating, label]) => <button key={rating} className={ratings[word.id] === rating ? "is-selected" : ""} aria-pressed={ratings[word.id] === rating} onClick={() => setRatings((current) => ({ ...current, [word.id]: rating }))}>{label}</button>)}
              </div>
            </article>)}</div>
            <div className="lm-feedback-submit"><span>{Object.keys(ratings).length} / {round.words.length} 个词已反馈</span><button className="lm-button lm-button-primary" disabled={!allRated || savingRound} onClick={() => void finishRound()}>{savingRound ? "正在保存…" : "保存并继续"}<ChevronRight size={17} /></button></div>
            {saveError && <p className="lm-form-error" role="alert">{saveError}</p>}
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
