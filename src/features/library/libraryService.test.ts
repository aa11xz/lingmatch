import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { DEFAULT_GAME_SETTINGS } from '../../types/domain'
import { createLibrary, deleteLibrary, getLibraries, getRecentResults, listWords, loadSettings, loadTheme, renameLibrary, replaceLibraryWords, saveGameResult, saveSettings, saveTheme } from './libraryService'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterAll(() => db.close())

describe('local library persistence', () => {
  it('keeps word libraries and their word pairs after the database connection is reopened', async () => {
    const created = await createLibrary('旅行英语', [
      { english: 'Journey', chinese: '旅程' },
      { english: 'Mountain', chinese: '山' },
    ])

    db.close()
    await db.open()

    expect(await getLibraries()).toEqual([created])
    expect(await listWords(created.id)).toMatchObject([
      { english: 'Journey', chinese: '旅程', libraryId: created.id },
      { english: 'Mountain', chinese: '山', libraryId: created.id },
    ])
  })

  it('updates library counts on replacement and deletes related words and results', async () => {
    const library = await createLibrary('基础词库', [{ english: 'Apple', chinese: '苹果' }])
    await renameLibrary(library.id, '水果')
    await replaceLibraryWords(library.id, [
      { english: 'Pear', chinese: '梨' },
      { english: 'Grape', chinese: '葡萄' },
    ])
    const updated = await getLibraries()
    expect(updated[0]).toMatchObject({ id: library.id, name: '水果', wordCount: 2 })
    expect(await listWords(library.id)).toMatchObject([
      { english: 'Pear', chinese: '梨' },
      { english: 'Grape', chinese: '葡萄' },
    ])

    const result = { id: 'result-1', libraryId: library.id, totalPairs: 2, correctPairs: 2, duration: 12, completedAt: 20, mistakes: 1 }
    await saveGameResult(result)
    expect(await getRecentResults()).toEqual([result])
    await deleteLibrary(library.id)
    expect(await getLibraries()).toEqual([])
    expect(await listWords(library.id)).toEqual([])
    expect(await getRecentResults()).toEqual([])
  })

  it('persists settings and theme independently from word libraries', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_GAME_SETTINGS)
    expect(await loadTheme()).toBe('light')
    const settings = { ...DEFAULT_GAME_SETTINGS, pairsPerRound: 4 as const, timerEnabled: true }
    await saveSettings(settings)
    await saveTheme('dark')
    db.close()
    await db.open()
    expect(await loadSettings()).toEqual(settings)
    expect(await loadTheme()).toBe('dark')
  })
})
