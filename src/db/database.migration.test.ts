import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { LingMatchDatabase } from './database'
import { DEFAULT_GAME_SETTINGS } from '../types/domain'

function legacyDatabase(name: string) {
  const database = new Dexie(name)
  database.version(4).stores({
    libraries: '&id, name, updatedAt',
    words: '&id, libraryId, english, chinese, createdAt, archivedAt',
    settings: '&key',
    preferences: '&key',
    results: '&id, libraryId, completedAt, taskId',
    learningProfiles: '&wordId, libraryId, status, nextReviewAt, lastPracticedAt, lastIncorrectAt',
    practiceEvents: '&id, wordId, libraryId, taskId, roundId, practicedAt, [wordId+practicedAt]',
    studyTasks: '&id, libraryId, status, startedAt, completedAt, [libraryId+status]',
  })
  return database
}

describe('data-preserving database migration', () => {
  it('preserves existing app data and maps legacy learning profiles to progress rows', async () => {
    const name = `LingMatch-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const legacy = legacyDatabase(name)
    await legacy.open()

    const library = { id: 'old-library', name: '旧词库', wordCount: 2, createdAt: 1, updatedAt: 2 }
    const word = { id: 'old-word', libraryId: library.id, english: 'apple', chinese: '苹果', createdAt: 3 }
    const wordWithoutProfile = { id: 'old-word-without-profile', libraryId: library.id, english: 'pear', chinese: '梨', createdAt: 4 }
    await legacy.table('libraries').add(library)
    await legacy.table('words').add(word)
    await legacy.table('words').add(wordWithoutProfile)
    await legacy.table('settings').add({ key: 'game', value: { ...DEFAULT_GAME_SETTINGS, pairsPerRound: 4 } })
    await legacy.table('preferences').add({ key: 'theme', value: 'dark' })
    await legacy.table('results').add({ id: 'old-result', libraryId: library.id, totalPairs: 1, correctPairs: 1, duration: 8, completedAt: 4 })
    await legacy.table('learningProfiles').add({
      wordId: word.id, libraryId: library.id, status: 'fuzzy', statusSource: 'manual',
      correctCount: 2, incorrectCount: 3, consecutiveCorrect: 0, repetitions: 1,
      intervalDays: 1, easeFactor: 2.3, lastPracticedAt: 5, lastIncorrectAt: 4,
      nextReviewAt: 6, updatedAt: 6,
    })
    await legacy.table('practiceEvents').add({
      id: 'old-event', wordId: word.id, libraryId: library.id, taskId: 'old-task',
      roundId: 'old-task:round:1', roundNumber: 1, mode: 'match', correct: false,
      misses: 1, rating: 'uncertain', practicedAt: 4,
    })
    await legacy.table('studyTasks').add({
      id: 'old-task', libraryId: library.id, mode: 'mixed', practiceMode: 'match',
      status: 'paused', targetCount: 1, roundSize: 4, plannedWordIds: [word.id],
      completedWordIds: [], reviewQueueWordIds: [], reviewedWordIds: [],
      currentRoundWordIds: [word.id], currentMissesByWord: {}, currentMatchedWordIds: [],
      roundNumber: 1, durationSeconds: 0, totalMistakes: 0, startedAt: 3,
      completedAt: null, updatedAt: 4,
    })
    legacy.close()

    const upgraded = new LingMatchDatabase(name)
    let reopened: LingMatchDatabase | undefined
    try {
      await upgraded.open()

      expect(upgraded.verno).toBe(5)
      expect(await upgraded.libraries.get(library.id)).toEqual(library)
      expect(await upgraded.words.get(word.id)).toEqual(word)
      expect(await upgraded.results.get('old-result')).toMatchObject({ id: 'old-result', libraryId: library.id })
      expect(await upgraded.practiceEvents.get('old-event')).toMatchObject({ id: 'old-event', wordId: word.id, misses: 1 })
      expect(await upgraded.studyTasks.get('old-task')).toMatchObject({ id: 'old-task', plannedWordIds: [word.id] })
      expect(await upgraded.settings.get('game')).toEqual({ key: 'game', value: { ...DEFAULT_GAME_SETTINGS, pairsPerRound: 4 } })
      expect(await upgraded.preferences.get('theme')).toEqual({ key: 'theme', value: 'dark' })
      expect(await upgraded.tables.find((table) => table.name === 'learningProfiles')?.get(word.id)).toMatchObject({
        status: 'fuzzy', correctCount: 2, incorrectCount: 3, easeFactor: 2.3,
      })
      expect(await upgraded.wordProgress.get(word.id)).toEqual({
        wordId: word.id,
        libraryId: library.id,
        state: 'weak',
        correctSessions: 2,
        wrongSessions: 3,
        consecutiveCorrect: 0,
        lastPracticedAt: 5,
        lastWrongAt: 4,
        nextReviewAt: 6,
        updatedAt: 6,
      })
      expect(await upgraded.wordProgress.get(wordWithoutProfile.id)).toMatchObject({
        wordId: wordWithoutProfile.id,
        libraryId: library.id,
        state: 'new',
        correctSessions: 0,
        wrongSessions: 0,
      })
      expect(await upgraded.systemMetadata.count()).toBe(0)

      const newLibrary = { id: 'new-library', name: '新词库', wordCount: 1, createdAt: 10, updatedAt: 11 }
      const newWord = { id: 'new-word', libraryId: newLibrary.id, english: 'book', chinese: '书', createdAt: 12 }
      await upgraded.transaction('rw', upgraded.libraries, upgraded.words, upgraded.wordProgress, async () => {
        await upgraded.libraries.add(newLibrary)
        await upgraded.words.add(newWord)
        await upgraded.wordProgress.add({
          wordId: newWord.id, libraryId: newLibrary.id, state: 'new', correctSessions: 0,
          wrongSessions: 0, consecutiveCorrect: 0, lastPracticedAt: null, lastWrongAt: null,
          nextReviewAt: null, updatedAt: 12,
        })
      })
      upgraded.close()

      reopened = new LingMatchDatabase(name)
      await reopened.open()
      expect(await reopened.libraries.get(newLibrary.id)).toEqual(newLibrary)
      expect(await reopened.words.get(newWord.id)).toEqual(newWord)
      expect(await reopened.wordProgress.get(newWord.id)).toMatchObject({ state: 'new', correctSessions: 0 })
      expect(await reopened.settings.get('game')).toEqual({ key: 'game', value: { ...DEFAULT_GAME_SETTINGS, pairsPerRound: 4 } })
      expect(await reopened.libraries.get(library.id)).toEqual(library)
      expect(await reopened.results.get('old-result')).toMatchObject({ id: 'old-result', libraryId: library.id })
    } finally {
      upgraded.close()
      reopened?.close()
      const cleanup = new Dexie(name)
      await cleanup.delete()
    }
  })
})
