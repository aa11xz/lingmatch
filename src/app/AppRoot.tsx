import { useEffect, useMemo } from 'react'
import { LingMatchApp } from '../ui/LingMatchApp'
import { parseImportFile } from '../features/importer/importManager'
import { exportLingMatchBackup, restoreLingMatchBackup } from '../features/backup/backupService'
import type { RestoreStrategy } from '../features/backup/backupService'
import {
  createLibrary as createLibraryService,
  deleteLibrary as deleteLibraryService,
  listWords,
  renameLibrary as renameLibraryService,
  replaceLibraryWords as replaceLibraryWordsService,
} from '../features/library/libraryService'
import {
  completeStudyRound,
  createStudyTask,
  getLearningProgress,
  getLearningDashboard,
  pauseStudyTask,
  recordPairResolution,
  resumeStudyTask,
} from '../features/learning/learningService'
import { useAppStore } from '../stores/appStore'
import type { PairCount, StudyTaskMode, WordPairDraft } from '../types/domain'

function clearLegacyLingMatchSessionPreferences() {
  if (typeof window === 'undefined') return
  try {
    const storage = window.sessionStorage
    const legacyKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key !== null)
      .filter((key) => key.startsWith('lingmatch-library-view:')
        || key === 'lingmatch-import-preview-query'
        || key === 'lingmatch-import-preview-filter'
        || key === 'lingmatch-import-preview-page')
    for (const key of legacyKeys) storage.removeItem(key)
  } catch {
    // The WebView can disable sessionStorage; all new preferences still default safely.
  }
}

export function AppRoot() {
  const libraries = useAppStore((state) => state.libraries)
  const settings = useAppStore((state) => state.settings)
  const history = useAppStore((state) => state.history)
  const theme = useAppStore((state) => state.theme)
  const ready = useAppStore((state) => state.ready)
  const error = useAppStore((state) => state.error)
  const initialize = useAppStore((state) => state.initialize)
  const refreshLibraries = useAppStore((state) => state.refreshLibraries)
  const refreshHistory = useAppStore((state) => state.refreshHistory)
  const persistSettings = useAppStore((state) => state.persistSettings)
  const persistTheme = useAppStore((state) => state.persistTheme)
  const callbacks = useMemo(() => ({
    async createLibrary(name: string, words: WordPairDraft[]) {
      await createLibraryService(name, words)
      await refreshLibraries()
    },
    async renameLibrary(id: string, name: string) {
      await renameLibraryService(id, name)
      await refreshLibraries()
    },
    async replaceLibraryWords(id: string, words: WordPairDraft[]) {
      await replaceLibraryWordsService(id, words)
      await refreshLibraries()
    },
    async deleteLibrary(id: string) {
      await deleteLibraryService(id)
      await Promise.all([refreshLibraries(), refreshHistory()])
    },
    createStudyTask(libraryId: string, mode: StudyTaskMode, roundSize: PairCount, targetCount = 50) {
      return createStudyTask({ libraryId, mode, roundSize, targetCount })
    },
    resumeStudyTask,
    pauseStudyTask,
    recordPairResolution,
    async completeStudyRound(taskId: string, roundNumber: number, durationSeconds: number) {
      const result = await completeStudyRound({ taskId, roundNumber, durationSeconds })
      await refreshHistory()
      return result
    },
    exportBackup: exportLingMatchBackup,
    async restoreBackup(backup: unknown, strategy: RestoreStrategy) {
      const summary = await restoreLingMatchBackup(backup, { strategy })
      await initialize()
      return summary
    },
  }), [initialize, refreshHistory, refreshLibraries])

  useEffect(() => {
    clearLegacyLingMatchSessionPreferences()
    void initialize()
  }, [initialize])

  if (!ready) return <div className="app-loading" role="status">正在打开本地词库…</div>
  if (error) return <main className="app-error"><h1>暂时无法打开 LingMatch</h1><p>{error}</p><button onClick={() => void initialize()}>重试</button></main>

  return (
    <LingMatchApp
      libraries={libraries}
      settings={settings}
      history={history}
      listWords={listWords}
      parseFile={parseImportFile}
      createLibrary={callbacks.createLibrary}
      replaceLibraryWords={callbacks.replaceLibraryWords}
      renameLibrary={callbacks.renameLibrary}
      deleteLibrary={callbacks.deleteLibrary}
      saveSettings={persistSettings}
      createStudyTask={callbacks.createStudyTask}
      resumeStudyTask={callbacks.resumeStudyTask}
      pauseStudyTask={callbacks.pauseStudyTask}
      recordPairResolution={callbacks.recordPairResolution}
      completeStudyRound={callbacks.completeStudyRound}
      getLearningDashboard={getLearningDashboard}
      getLearningProgress={getLearningProgress}
      theme={theme}
      saveTheme={persistTheme}
      exportBackup={callbacks.exportBackup}
      restoreBackup={callbacks.restoreBackup}
    />
  )
}
