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
  GameResult,
  GameSettings,
  ImportOptions,
  ParsedImport,
  WordEntry,
  WordLibrary,
  WordPairDraft,
} from "../types/domain";
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
  const openImport = (libraryId = "") => { setReplaceTargetId(libraryId); setScreen("import"); };

  const handleStartGame = useCallback(async () => {
    if (!activeLibrary) {
      openImport();
      return;
    }
    setBusy(true);
    setAppError("");
    try {
      const words = await props.listWords(activeLibrary.id);
      if (words.length === 0) {
        setAppError("这个词库还没有词条，先导入一份词表吧。");
        setScreen("home");
        return;
      }
      setGameWords(words);
      setGameSeed((seed) => seed + 1);
      setScreen("game");
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "读取词库失败，请再试一次。");
    } finally {
      setBusy(false);
    }
  }, [activeLibrary, props]);

  const handleCreateLibrary = async (name: string, words: WordPairDraft[]) => {
    newIdsBeforeCreate.current = new Set(props.libraries.map((library) => library.id));
    pendingLibraryName.current = name;
    await props.createLibrary(name, words);
  };

  const handleThemeChange = async (nextTheme: Theme) => {
    setTheme(nextTheme);
    await props.saveTheme?.(nextTheme);
  };

  const handleResult = async (result: GameResult) => {
    await props.saveResult(result);
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
                busy={busy}
                onStart={handleStartGame}
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
                settings={props.settings ?? DEFAULT_SETTINGS}
                onExit={() => setScreen("home")}
                onFinish={handleResult}
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
  busy: boolean;
  onStart: () => void;
  onImport: () => void;
  onLibrary: () => void;
  onSelectLibrary: (id: string) => void;
  onOpenSettings: () => void;
}

function HomeScreen({ libraries, activeLibrary, selectedLibraryId, settings, history, busy, onStart, onImport, onLibrary, onSelectLibrary, onOpenSettings }: HomeScreenProps) {
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
            <button className="lm-button lm-button-primary lm-start-button" disabled={busy || count === 0} onClick={onStart}>
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
  onSelect: (id: string) => void;
  onBack: () => void;
  onImport: () => void;
  onReimport: (id: string) => void;
  onCreateLibrary: (name: string, words: WordPairDraft[]) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function LibraryScreen({ libraries, selectedLibraryId, listWords, onSelect, onBack, onImport, onReimport, onCreateLibrary, onRename, onDelete }: LibraryScreenProps) {
  const [entries, setEntries] = useState<WordEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<"create" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const selected = libraries.find((library) => library.id === selectedLibraryId);

  useEffect(() => {
    let cancelled = false;
    if (!selectedLibraryId) { setEntries([]); return; }
    setLoading(true);
    listWords(selectedLibraryId)
      .then((words) => { if (!cancelled) setEntries(words); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "读取词条失败。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedLibraryId, listWords, libraries]);

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
                  <div className="lm-word-list-labels"><span>ENGLISH</span><span>中文</span></div>
                  <div className="lm-word-list">{visibleEntries.map((word) => <div className="lm-word-row" key={word.id}><span>{word.english}</span><span>{word.chinese}</span></div>)}</div>
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
  const [keepDuplicates, setKeepDuplicates] = useState(false);
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
  const readyRows = rows.filter((row, index) => row.english.trim() && row.chinese.trim() && (keepDuplicates || !duplicateIndexes.has(index)));

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
          {isSpreadsheet && parsed.columns && parsed.columns.length > 0 && <div className="lm-column-map"><div><strong>确认对应列</strong><small>自动识别后仍可手动调整</small></div><label>英文列<select value={englishColumn ?? ""} onChange={(event) => chooseColumns(Number(event.target.value), chineseColumn ?? parsed.columns![1]?.index ?? 1)}>{parsed.columns.map((column) => <option key={column.index} value={column.index}>{column.label}</option>)}</select></label><label>中文列<select value={chineseColumn ?? ""} onChange={(event) => chooseColumns(englishColumn ?? parsed.columns![0]?.index ?? 0, Number(event.target.value))}>{parsed.columns.map((column) => <option key={column.index} value={column.index}>{column.label}</option>)}</select></label></div>}

          {parsed.warnings.length > 0 && <div className="lm-import-warning" role="status"><CircleHelp size={17} /><div>{parsed.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></div>}
          {parsed.format === "pdf" && rows.length === 0 && <div className="lm-import-warning"><FileText size={17} /><p>没有提取到可用的文字。扫描版 PDF 需要 OCR；当前版本不包含 OCR，请换用文本型 PDF 或 CSV/TXT。</p></div>}

          <div className="lm-import-review">
            <div className="lm-import-review-head"><div><span className="lm-eyebrow">确认后再保存</span><h2>检查词条</h2></div><span className="lm-review-count"><strong>{readyRows.length}</strong> 条可导入{duplicateIndexes.size > 0 && <em> · {duplicateIndexes.size} 条重复</em>}{emptyCount > 0 && <em> · {emptyCount} 条待补全</em>}</span></div>
            {replacing ? <div className="lm-replace-notice"><RefreshCw size={16} /><span><strong>替换词库内容</strong><small>现有 {replaceLibrary?.wordCount ?? 0} 个词条会被替换，词库名称和练习记录保留。</small></span></div> : <><label className="lm-field-label" htmlFor="import-library-name">新词库名称</label><input id="import-library-name" className="lm-text-input lm-import-name" value={libraryName} onChange={(event) => setLibraryName(event.target.value)} maxLength={60} /></>}
            <div className="lm-preview-table-wrap">
              <div className="lm-preview-header"><span>英文</span><span>中文释义</span><span className="sr-only">操作</span></div>
              <div className="lm-preview-body">{rows.map((row, index) => {
                const empty = !row.english.trim() || !row.chinese.trim();
                const duplicate = duplicateIndexes.has(index);
                return <div className={`lm-preview-row ${empty ? "is-incomplete" : ""} ${duplicate ? "is-duplicate" : ""}`} key={index}>
                  <input aria-label={`第 ${index + 1} 行英文`} value={row.english} onChange={(event) => updateRow(index, "english", event.target.value)} placeholder="English" />
                  <input aria-label={`第 ${index + 1} 行中文`} value={row.chinese} onChange={(event) => updateRow(index, "chinese", event.target.value)} placeholder="中文释义" />
                  <span className="lm-row-status">{duplicate ? <span className="lm-duplicate-tag">重复</span> : empty ? <span className="lm-incomplete-tag">待补</span> : null}<button className="lm-icon-button" aria-label={`删除第 ${index + 1} 行`} onClick={() => removeRow(index)}><X size={15} /></button></span>
                </div>;
              })}</div>
              <button className="lm-add-row" onClick={addRow}><Plus size={16} /> 添加一行</button>
            </div>
            {duplicateIndexes.size > 0 && <label className="lm-checkbox-label lm-duplicate-toggle"><input type="checkbox" checked={keepDuplicates} onChange={(event) => setKeepDuplicates(event.target.checked)} /> 保留重复词条</label>}
            {error && <div className="lm-form-error lm-import-error" role="alert">{error}</div>}
            <div className="lm-import-footer"><span><CheckCircle2 size={16} /> 文件只在本地处理，不会上传</span><button className="lm-button lm-button-primary" disabled={saving || readyRows.length === 0} onClick={() => void submitImport()}>{saving ? "正在保存…" : replacing ? `确认替换 ${readyRows.length} 条` : `确认导入 ${readyRows.length} 条`}<ChevronRight size={17} /></button></div>
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
  settings: GameSettings;
  onExit: () => void;
  onFinish: (result: GameResult) => Promise<void>;
  onReplay: () => void;
}

function MatchGame({ library, entries, settings, onExit, onFinish, onReplay }: MatchGameProps) {
  const shouldReduceMotion = useReducedMotion();
  const round = useMemo(() => prepareMatchRound(entries, settings.pairsPerRound), [entries, settings.pairsPerRound]);
  const [selectedEnglish, setSelectedEnglish] = useState<string | null>(null);
  const [selectedChinese, setSelectedChinese] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(() => new Set());
  const [errorIds, setErrorIds] = useState<Set<string>>(() => new Set());
  const [locked, setLocked] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [saveError, setSaveError] = useState("");
  const startAt = useRef(Date.now());
  const completedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const animationTimer = useRef<number | null>(null);

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

  const resolvePair = (englishId: string, chineseId: string) => {
    if (locked || !englishId || !chineseId) return;
    setLocked(true);
    if (englishId === chineseId) {
      playTone(true); vibrate(18);
      animationTimer.current = window.setTimeout(() => {
        setMatched((current) => new Set(current).add(englishId));
        setSelectedEnglish(null); setSelectedChinese(null); setLocked(false);
      }, shouldReduceMotion ? 0 : 360);
    } else {
      playTone(false); vibrate(35); setMistakes((current) => current + 1);
      setErrorIds(new Set([englishId, chineseId]));
      animationTimer.current = window.setTimeout(() => {
        setErrorIds(new Set()); setSelectedEnglish(null); setSelectedChinese(null); setLocked(false);
      }, shouldReduceMotion ? 0 : 460);
    }
  };

  useEffect(() => {
    if (!round.words.length || matched.size !== round.words.length || completedRef.current) return;
    completedRef.current = true;
    const result: GameResult = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      libraryId: library.id,
      totalPairs: round.words.length,
      correctPairs: round.words.length,
      duration: Math.floor((Date.now() - startAt.current) / 1000),
      completedAt: Date.now(),
      mistakes,
    };
    void onFinish(result).catch((cause) => setSaveError(cause instanceof Error ? cause.message : "本轮完成了，但保存记录失败。"));
  }, [library.id, matched.size, mistakes, onFinish, round.words]);

  useEffect(() => () => {
    if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
    void audioRef.current?.close();
  }, []);

  const progress = round.words.length ? matched.size / round.words.length : 0;
  const accuracy = round.words.length + mistakes === 0 ? 100 : Math.round((round.words.length / (round.words.length + mistakes)) * 100);

  if (!round.words.length) return <div className="lm-game-empty"><button className="lm-back-link" onClick={onExit}><ChevronLeft size={17} /> 返回</button><h2>这个词库还没有词条</h2><p>添加一些中英词条后，马上开始配对。</p></div>;

  return (
    <div className="lm-game-wrap">
      <header className="lm-game-header">
        <button className="lm-icon-button lm-game-exit" aria-label="退出本轮" onClick={() => setExitConfirm(true)}><ArrowLeft size={19} /></button>
        <div className="lm-game-heading"><span>{library.name}</span><strong>中英配对</strong></div>
        <div className="lm-game-meta">{settings.timerEnabled && <span className="lm-timer-pill"><Clock3 size={15} /> {formatDuration(elapsed)}</span>}<span className="lm-pair-count"><strong>{matched.size}</strong> / {round.words.length}</span></div>
      </header>
      <div className="lm-game-progress"><div style={{ width: `${progress * 100}%` }} /></div>
      <div className="lm-game-content">
        {matched.size === round.words.length ? (
          <section className="lm-game-complete" aria-live="polite">
            <div className="lm-win-confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
            <motion.div className="lm-win-icon" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 210, damping: 16 }}><Trophy size={34} /></motion.div>
            <span className="lm-eyebrow">这一轮完成啦</span><h1>配得真漂亮。</h1><p>所有词条都找到自己的搭档。</p>
            <div className="lm-win-stats"><div><strong>{round.words.length}</strong><span>完成配对</span></div><div><strong>{formatDuration(Math.floor((Date.now() - startAt.current) / 1000))}</strong><span>用时</span></div><div><strong>{accuracy}%</strong><span>准确率</span></div></div>
            <div className="lm-win-performance"><Sparkles size={17} />{accuracy >= 90 ? "状态很好，继续保持！" : accuracy >= 70 ? "不错，再来一轮会更顺。" : "熟悉得越来越多了。"}</div>
            {saveError && <p className="lm-form-error" role="alert">{saveError}</p>}
            <div className="lm-win-actions"><button className="lm-button lm-button-primary" onClick={onReplay}><RotateCw size={17} /> 再玩一次</button><button className="lm-button lm-button-secondary" onClick={onExit}>返回首页</button></div>
          </section>
        ) : (
          <>
            <div className="lm-game-instructions"><span className="lm-game-step"><span>配对进度</span><strong>{matched.size} / {round.words.length}</strong></span><div><h1>找到相配的词。</h1><p>依次点击英文和对应的中文释义</p></div><span className="lm-game-remaining">还剩 <strong>{round.words.length - matched.size}</strong> 对</span></div>
            <div className="lm-match-board" role="group" aria-label="中英配对棋盘">
              <MatchColumn label="ENGLISH" cards={round.english} selectedId={selectedEnglish} matched={matched} errorIds={errorIds} locked={locked} onSelect={handleSelect} />
              <div className="lm-board-divider" aria-hidden="true"><span>⇄</span></div>
              <MatchColumn label="中文释义" cards={round.chinese} selectedId={selectedChinese} matched={matched} errorIds={errorIds} locked={locked} onSelect={handleSelect} />
            </div>
            <div className="lm-game-footer"><span><span className="lm-footer-dot" />{matched.size === 0 ? "慢慢找，第一对就在眼前" : `已经配好 ${matched.size} 对`}</span>{settings.timerEnabled && <span className="lm-footer-time"><Timer size={15} /> {formatDuration(elapsed)}</span>}</div>
          </>
        )}
      </div>
      <AnimatePresence>{exitConfirm && <Dialog title="结束这一轮？" onClose={() => setExitConfirm(false)}><p className="lm-dialog-copy">当前进度不会记入练习记录。</p><div className="lm-dialog-actions"><button className="lm-button lm-button-secondary" onClick={() => setExitConfirm(false)}>继续配对</button><button className="lm-button lm-button-danger" onClick={onExit}><ArrowLeft size={16} /> 退出本轮</button></div></Dialog>}</AnimatePresence>
    </div>
  );
}

interface MatchColumnProps {
  label: string;
  cards: MatchCardItem[];
  selectedId: string | null;
  matched: Set<string>;
  errorIds: Set<string>;
  locked: boolean;
  onSelect: (card: MatchCardItem) => void;
}

function MatchColumn({ label, cards, selectedId, matched, errorIds, locked, onSelect }: MatchColumnProps) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="lm-match-column"><div className="lm-column-heading"><span>{label}</span></div><div className="lm-card-stack">
      <AnimatePresence initial={false}>{cards.map((card) => {
        const isMatched = matched.has(card.wordId);
        if (isMatched) return null;
        return <motion.button
          key={card.wordId}
          layout
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, x: errorIds.has(card.wordId) ? [0, -6, 6, -4, 4, 0] : 0 }}
          exit={{ opacity: 0, scale: 0.84, y: -4 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.24, layout: { type: "spring", stiffness: 300, damping: 28 } }}
          className={`lm-match-card ${selectedId === card.wordId ? "is-selected" : ""} ${errorIds.has(card.wordId) ? "is-error" : ""}`}
          disabled={locked}
          aria-pressed={selectedId === card.wordId}
          onClick={() => onSelect(card)}
        >
          <span>{card.label}</span>
        </motion.button>;
      })}</AnimatePresence>
    </div></div>
  );
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
