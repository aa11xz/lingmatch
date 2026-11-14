export type PairCount = 4 | 6 | 8 | 10 | 12

export interface WordEntry {
  id: string
  english: string
  chinese: string
  libraryId: string
  createdAt: number
}

export interface WordLibrary {
  id: string
  name: string
  wordCount: number
  createdAt: number
  updatedAt: number
}

export interface GameSettings {
  pairsPerRound: PairCount
  timerEnabled: boolean
  soundEnabled: boolean
  vibrationEnabled: boolean
}

export interface GameResult {
  id: string
  libraryId: string
  totalPairs: number
  correctPairs: number
  duration: number
  completedAt: number
  mistakes?: number
}

export type AppTheme = 'light' | 'dark'

export interface WordPairDraft {
  english: string
  chinese: string
}

export type ImportFormat = 'csv' | 'xlsx' | 'xls' | 'json' | 'txt' | 'pdf'
export type ImportDelimiter = 'auto' | 'tab' | 'comma' | 'chineseComma' | 'pipe' | 'colon' | 'semicolon'

export interface ImportOptions {
  sheetName?: string
  delimiter?: ImportDelimiter
  hasHeader?: boolean
  englishColumn?: number
  chineseColumn?: number
}

export interface ImportColumn {
  index: number
  label: string
}

export interface ParsedImport {
  fileName: string
  format: ImportFormat
  words: WordPairDraft[]
  warnings: string[]
  sheetNames?: string[]
  columns?: ImportColumn[]
  sourceRows?: string[][]
  hasHeader: boolean
  suggestedEnglishColumn?: number
  suggestedChineseColumn?: number
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  pairsPerRound: 8,
  timerEnabled: false,
  soundEnabled: false,
  vibrationEnabled: false,
}
