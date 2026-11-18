import Dexie, { type EntityTable } from 'dexie'
import { type AppTheme, type GameResult, type GameSettings, type PracticeEvent, type StudyTask, type WordEntry, type WordProgress, type WordProgressState, type WordLibrary } from '../types/domain'

interface StoredPreference<T> {
  key: string
  value: T
}

interface LegacyLearningProfile {
  wordId: string
  libraryId: string
  status?: unknown
  state?: unknown
  correctCount?: unknown
  incorrectCount?: unknown
  correctSessions?: unknown
  wrongSessions?: unknown
  consecutiveCorrect?: unknown
  lastPracticedAt?: unknown
  lastIncorrectAt?: unknown
  lastWrongAt?: unknown
  nextReviewAt?: unknown
  updatedAt?: unknown
}

const legacyProgressStates: Record<string, WordProgressState> = {
  new: 'new',
  unlearned: 'new',
  learning: 'learning',
  weak: 'weak',
  fuzzy: 'weak',
  familiar: 'familiar',
  mastered: 'mastered',
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function nullableTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function migrateLegacyProgress(profile: LegacyLearningProfile | undefined, word: WordEntry, timestamp: number): WordProgress {
  const correctSessions = finiteCount(profile?.correctSessions ?? profile?.correctCount)
  const wrongSessions = finiteCount(profile?.wrongSessions ?? profile?.incorrectCount)
  const legacyStatus = typeof profile?.status === 'string'
    ? profile.status
    : typeof profile?.state === 'string' ? profile.state : ''
  const state = legacyProgressStates[legacyStatus]
    ?? (wrongSessions > 0 ? 'weak' : correctSessions > 0 ? 'learning' : 'new')

  return {
    wordId: word.id,
    libraryId: word.libraryId,
    state,
    correctSessions,
    wrongSessions,
    consecutiveCorrect: finiteCount(profile?.consecutiveCorrect),
    lastPracticedAt: nullableTimestamp(profile?.lastPracticedAt),
    lastWrongAt: nullableTimestamp(profile?.lastWrongAt ?? profile?.lastIncorrectAt),
    nextReviewAt: nullableTimestamp(profile?.nextReviewAt),
    updatedAt: nullableTimestamp(profile?.updatedAt) ?? timestamp,
  }
}

export class LingMatchDatabase extends Dexie {
  libraries!: EntityTable<WordLibrary, 'id'>
  words!: EntityTable<WordEntry, 'id'>
  settings!: EntityTable<StoredPreference<GameSettings>, 'key'>
  preferences!: EntityTable<StoredPreference<AppTheme>, 'key'>
  results!: EntityTable<GameResult, 'id'>
  wordProgress!: EntityTable<WordProgress, 'wordId'>
  practiceEvents!: EntityTable<PracticeEvent, 'id'>
  studyTasks!: EntityTable<StudyTask, 'id'>
  systemMetadata!: EntityTable<StoredPreference<string | number | boolean>, 'key'>

  constructor(name = 'LingMatch') {
    super(name)
    this.version(1).stores({
      libraries: '&id, name, updatedAt',
      words: '&id, libraryId, english, chinese, createdAt',
      settings: '&key',
      preferences: '&key',
      results: '&id, libraryId, completedAt',
    })
    this.version(2).stores({
      libraries: '&id, name, updatedAt',
      words: '&id, libraryId, english, chinese, createdAt, archivedAt',
      settings: '&key',
      preferences: '&key',
      results: '&id, libraryId, completedAt, taskId',
      learningProfiles: '&wordId, libraryId, status, nextReviewAt, lastPracticedAt, lastIncorrectAt',
      practiceEvents: '&id, wordId, libraryId, taskId, roundId, practicedAt, [wordId+practicedAt]',
      studyTasks: '&id, libraryId, status, startedAt, completedAt',
    }).upgrade(async (transaction) => {
      const words = await transaction.table('words').toArray() as WordEntry[]
      const timestamp = Date.now()
      const profiles: WordProgress[] = words.map((word) => ({
        wordId: word.id,
        libraryId: word.libraryId,
        state: 'new',
        correctSessions: 0,
        wrongSessions: 0,
        consecutiveCorrect: 0,
        lastPracticedAt: null,
        lastWrongAt: null,
        nextReviewAt: null,
        updatedAt: timestamp,
      }))
      if (profiles.length) await transaction.table('learningProfiles').bulkAdd(profiles)
    })
    this.version(3).stores({
      libraries: '&id, name, updatedAt',
      words: '&id, libraryId, english, chinese, createdAt, archivedAt',
      settings: '&key',
      preferences: '&key',
      results: '&id, libraryId, completedAt, taskId',
      learningProfiles: '&wordId, libraryId, status, nextReviewAt, lastPracticedAt, lastIncorrectAt',
      practiceEvents: '&id, wordId, libraryId, taskId, roundId, practicedAt, [wordId+practicedAt]',
      studyTasks: '&id, libraryId, status, startedAt, completedAt, [libraryId+status]',
    })
    // v4 keeps every table and index intact; it introduces only an optional
    // per-task resolution key for making accidental duplicate pair taps idempotent.
    this.version(4).stores({
      libraries: '&id, name, updatedAt',
      words: '&id, libraryId, english, chinese, createdAt, archivedAt',
      settings: '&key',
      preferences: '&key',
      results: '&id, libraryId, completedAt, taskId',
      learningProfiles: '&wordId, libraryId, status, nextReviewAt, lastPracticedAt, lastIncorrectAt',
      practiceEvents: '&id, wordId, libraryId, taskId, roundId, practicedAt, [wordId+practicedAt]',
      studyTasks: '&id, libraryId, status, startedAt, completedAt, [libraryId+status]',
    })
    this.version(5).stores({
      libraries: '&id, name, updatedAt',
      words: '&id, libraryId, english, chinese, createdAt, archivedAt',
      settings: '&key',
      preferences: '&key',
      results: '&id, libraryId, completedAt, taskId',
      // Retain the original records as a recovery source; v5 adds the new
      // progress model without deleting legacy learning data.
      learningProfiles: '&wordId, libraryId, status, nextReviewAt, lastPracticedAt, lastIncorrectAt',
      wordProgress: '&wordId, libraryId, state, nextReviewAt, lastPracticedAt, lastWrongAt',
      practiceEvents: '&id, wordId, libraryId, taskId, roundId, practicedAt, [wordId+practicedAt], [taskId+roundId+wordId]',
      studyTasks: '&id, libraryId, status, startedAt, completedAt, [libraryId+status]',
      systemMetadata: '&key',
    }).upgrade(async (transaction) => {
      // Keep every existing business row. New progress rows are derived from
      // legacy profiles, while the original profiles remain available for
      // recovery and any fields not represented by the new model.
      const [words, profiles] = await Promise.all([
        transaction.table('words').toArray() as Promise<WordEntry[]>,
        transaction.table('learningProfiles').toArray() as Promise<LegacyLearningProfile[]>,
      ])
      const profilesByWordId = new Map(profiles.map((profile) => [profile.wordId, profile]))
      const timestamp = Date.now()
      const progress = words.map((word) => migrateLegacyProgress(profilesByWordId.get(word.id), word, timestamp))
      if (progress.length) await transaction.table('wordProgress').bulkAdd(progress)
    })
  }
}

export const db = new LingMatchDatabase()
