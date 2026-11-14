export type PairCount = 4 | 6 | 8 | 10 | 12

export interface WordEntry {
  id: string
  english: string
  chinese: string
  libraryId: string
  createdAt: number
  archivedAt?: number
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
  taskId?: string
  roundNumber?: number
  mode?: PracticeMode
}

export type WordLearningStatus = 'unlearned' | 'learning' | 'fuzzy' | 'familiar' | 'mastered'
export type PracticeMode = 'match' | 'flashcard' | 'multipleChoice' | 'spelling' | 'listening'
export type StudyTaskMode = 'new' | 'wrong' | 'due' | 'mixed' | 'all' | 'weak'
export type ReviewRating = 'forgotten' | 'uncertain' | 'remembered'
export type StudyTaskStatus = 'in-progress' | 'completed' | 'paused'

export interface WordLearningProfile {
  wordId: string
  libraryId: string
  status: WordLearningStatus
  statusSource: 'system' | 'manual'
  correctCount: number
  incorrectCount: number
  consecutiveCorrect: number
  repetitions: number
  intervalDays: number
  easeFactor: number
  lastPracticedAt: number | null
  lastIncorrectAt: number | null
  nextReviewAt: number | null
  updatedAt: number
}

export interface PracticeEvent {
  id: string
  wordId: string
  libraryId: string
  taskId: string
  roundId: string
  roundNumber: number
  mode: PracticeMode
  correct: boolean
  misses: number
  rating: ReviewRating
  practicedAt: number
}

export interface StudyTask {
  id: string
  libraryId: string
  mode: StudyTaskMode
  practiceMode: PracticeMode
  status: StudyTaskStatus
  targetCount: number
  roundSize: PairCount
  plannedWordIds: string[]
  completedWordIds: string[]
  reviewQueueWordIds: string[]
  reviewedWordIds: string[]
  currentRoundWordIds: string[]
  currentMissesByWord: Record<string, number>
  currentMatchedWordIds: string[]
  roundNumber: number
  durationSeconds: number
  totalMistakes: number
  startedAt: number
  completedAt: number | null
  updatedAt: number
}

export interface WordReviewOutcome {
  wordId: string
  misses: number
  rating: ReviewRating
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

export interface LearningStats {
  total: number
  unlearned: number
  learning: number
  fuzzy: number
  familiar: number
  mastered: number
  due: number
  weak: number
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  pairsPerRound: 8,
  timerEnabled: false,
  soundEnabled: false,
  vibrationEnabled: false,
}
