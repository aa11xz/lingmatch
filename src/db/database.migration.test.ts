import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { LingMatchDatabase } from './database'
import { DEFAULT_GAME_SETTINGS } from '../types/domain'

describe('database v1 to v2 upgrade', () => {
  it('backfills learning profiles and preserves existing words, preferences, and results', async () => {
    const name = `LingMatch-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const legacy = new Dexie(name)
    legacy.version(1).stores({
      libraries: '&id, name, updatedAt',
      words: '&id, libraryId, english, chinese, createdAt',
      settings: '&key',
      preferences: '&key',
      results: '&id, libraryId, completedAt',
    })
    await legacy.open()
    const library = { id: 'library-1', name: '旧词库', wordCount: 1, createdAt: 1, updatedAt: 2 }
    const word = { id: 'word-1', libraryId: library.id, english: 'apple', chinese: '苹果', createdAt: 3 }
    const result = { id: 'result-1', libraryId: library.id, totalPairs: 1, correctPairs: 1, duration: 8, completedAt: 4 }
    await legacy.table('libraries').add(library)
    await legacy.table('words').add(word)
    await legacy.table('settings').add({ key: 'game', value: { ...DEFAULT_GAME_SETTINGS, pairsPerRound: 4 } })
    await legacy.table('preferences').add({ key: 'theme', value: 'dark' })
    await legacy.table('results').add(result)
    legacy.close()

    const upgraded = new LingMatchDatabase(name)
    try {
      await upgraded.open()

      expect(await upgraded.libraries.get(library.id)).toEqual(library)
      expect(await upgraded.words.get(word.id)).toEqual(word)
      expect(await upgraded.learningProfiles.get(word.id)).toMatchObject({
        wordId: word.id,
        libraryId: library.id,
        status: 'unlearned',
        correctCount: 0,
        incorrectCount: 0,
      })
      expect(await upgraded.results.get(result.id)).toEqual(result)
      expect(await upgraded.settings.get('game')).toEqual({ key: 'game', value: { ...DEFAULT_GAME_SETTINGS, pairsPerRound: 4 } })
      expect(await upgraded.preferences.get('theme')).toEqual({ key: 'theme', value: 'dark' })
    } finally {
      await upgraded.delete()
    }
  })
})
