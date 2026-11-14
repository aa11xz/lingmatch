import { create } from 'zustand'
import { DEFAULT_GAME_SETTINGS, type AppTheme, type GameResult, type GameSettings, type WordLibrary } from '../types/domain'
import { getLibraries, getRecentResults, loadSettings, loadTheme, saveGameResult, saveSettings, saveTheme } from '../features/library/libraryService'

interface AppState {
  libraries: WordLibrary[]
  settings: GameSettings
  history: GameResult[]
  theme: AppTheme
  ready: boolean
  error: string
  initialize(): Promise<void>
  refreshLibraries(): Promise<void>
  refreshHistory(): Promise<void>
  persistSettings(settings: GameSettings): Promise<void>
  persistTheme(theme: AppTheme): Promise<void>
  persistResult(result: GameResult): Promise<void>
  setError(error: string): void
}

export const useAppStore = create<AppState>((set) => ({
  libraries: [],
  settings: DEFAULT_GAME_SETTINGS,
  history: [],
  theme: 'light',
  ready: false,
  error: '',
  async initialize() {
    try {
      const [libraries, settings, history, theme] = await Promise.all([
        getLibraries(),
        loadSettings(),
        getRecentResults(),
        loadTheme(),
      ])
      set({ libraries, settings, history, theme, ready: true, error: '' })
    } catch (error) {
      set({ ready: true, error: error instanceof Error ? error.message : '无法读取本地数据，请检查浏览器存储权限。' })
    }
  },
  async refreshLibraries() {
    set({ libraries: await getLibraries() })
  },
  async refreshHistory() {
    set({ history: await getRecentResults() })
  },
  async persistSettings(settings) {
    await saveSettings(settings)
    set({ settings })
  },
  async persistTheme(theme) {
    await saveTheme(theme)
    set({ theme })
  },
  async persistResult(result) {
    await saveGameResult(result)
    set({ history: await getRecentResults() })
  },
  setError(error) {
    set({ error })
  },
}))
