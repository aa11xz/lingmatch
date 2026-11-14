import Dexie, { type EntityTable } from 'dexie'
import type { AppTheme, GameResult, GameSettings, PracticeEvent, StudyTask, WordEntry, WordLearningProfile, WordLibrary } from '../types/domain'

interface StoredPreference<T> {
  key: string
  value: T
}

export class LingMatchDatabase extends Dexie {
  libraries!: EntityTable<WordLibrary, 'id'>
  words!: EntityTable<WordEntry, 'id'>
  settings!: EntityTable<StoredPreference<GameSettings>, 'key'>
  preferences!: EntityTable<StoredPreference<AppTheme>, 'key'>
  results!: EntityTable<GameResult, 'id'>
  learningProfiles!: EntityTable<WordLearningProfile, 'wordId'>
  practiceEvents!: EntityTable<PracticeEvent, 'id'>
  studyTasks!: EntityTable<StudyTask, 'id'>

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
      const profiles: WordLearningProfile[] = words.map((word) => ({
        wordId: word.id,
        libraryId: word.libraryId,
        status: 'unlearned',
        statusSource: 'system',
        correctCount: 0,
        incorrectCount: 0,
        consecutiveCorrect: 0,
        repetitions: 0,
        intervalDays: 0,
        easeFactor: 2.3,
        lastPracticedAt: null,
        lastIncorrectAt: null,
        nextReviewAt: null,
        updatedAt: timestamp,
      }))
      if (profiles.length) await transaction.table('learningProfiles').bulkAdd(profiles)
    })
  }
}

export const db = new LingMatchDatabase()
