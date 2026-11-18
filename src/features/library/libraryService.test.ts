import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { DEFAULT_GAME_SETTINGS } from '../../types/domain'
import { completeStudyRound, createStudyTask, getLearningProgress, getWordPracticeHistory, recordPairResolution } from '../learning/learningService'
import { createLibrary, deleteLibrary, getLibraries, getRecentResults, listWords, loadSettings, loadTheme, renameLibrary, replaceLibraryWords, saveSettings, saveTheme } from './libraryService'

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

    const task = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4 })
    for (const wordId of task.task.currentRoundWordIds) {
      await recordPairResolution({
        taskId: task.task.id,
        roundNumber: task.task.roundNumber,
        englishWordId: wordId,
        chineseWordId: wordId,
        correct: true,
      })
    }
    const completed = await completeStudyRound({
      taskId: task.task.id,
      roundNumber: task.task.roundNumber,
      durationSeconds: 12,
      timestamp: 20,
    })
    expect(completed.task.status).toBe('completed')
    expect(completed.result).toMatchObject({
      libraryId: library.id,
      totalPairs: 2,
      correctPairs: 2,
      duration: 12,
      completedAt: 20,
    })
    expect(await getRecentResults()).toEqual([completed.result])
    await deleteLibrary(library.id)
    expect(await getLibraries()).toEqual([])
    expect(await listWords(library.id)).toEqual([])
    expect(await getRecentResults()).toEqual([])
    expect(await getLearningProgress(library.id)).toEqual([])
    expect(await db.practiceEvents.count()).toBe(0)
    expect(await db.studyTasks.count()).toBe(0)
  })

  it('preserves exact word identities and learning history while archiving changed meanings', async () => {
    const library = await createLibrary('保留学习记录', [
      { english: 'Apple', chinese: '苹果' },
      { english: 'Book', chinese: '书' },
    ])
    const originalWords = await listWords(library.id)
    const apple = originalWords[0]!
    const book = originalWords[1]!
    const appleProgress = await db.wordProgress.get(apple.id)
    await db.wordProgress.put({ ...appleProgress!, state: 'mastered' })
    await db.practiceEvents.add({
      id: 'practice-apple-1',
      wordId: apple.id,
      libraryId: library.id,
      taskId: 'old-task',
      roundId: 'old-task:round:1',
      mode: 'comprehensive',
      mistakes: 0,
      firstTryCorrect: true,
      practicedAt: 500,
    })

    await replaceLibraryWords(library.id, [
      { english: 'APPLE', chinese: '苹果' },
      { english: 'Book', chinese: '书籍' },
    ])

    const currentWords = await listWords(library.id)
    const currentApple = currentWords.find((word) => word.english === 'APPLE')!
    const currentBook = currentWords.find((word) => word.english === 'Book')!
    expect(currentApple.id).toBe(apple.id)
    expect(currentBook.id).not.toBe(book.id)
    expect((await getLearningProgress(library.id)).find((profile) => profile.wordId === apple.id)?.state).toBe('mastered')
    expect((await getLearningProgress(library.id)).find((profile) => profile.wordId === currentBook.id)?.state).toBe('new')
    expect(await getWordPracticeHistory(apple.id)).toMatchObject([{ id: 'practice-apple-1', wordId: apple.id }])
    expect((await db.words.get(book.id))?.archivedAt).toBeTypeOf('number')
    expect((await getLearningProgress(library.id)).some((profile) => profile.wordId === book.id)).toBe(true)
  })

  it('matches duplicate exact pairs in stable creation order during replacement', async () => {
    const pair = { english: 'Set', chinese: '一组' }
    const library = await createLibrary('重复词条', [pair, pair])
    const original = await listWords(library.id)
    const first = original[0]!
    const second = original[1]!
    const firstProgress = await db.wordProgress.get(first.id)
    const secondProgress = await db.wordProgress.get(second.id)
    await db.wordProgress.put({ ...firstProgress!, state: 'weak' })
    await db.wordProgress.put({ ...secondProgress!, state: 'familiar' })

    await replaceLibraryWords(library.id, [pair, pair])

    const replaced = await listWords(library.id)
    const progress = new Map((await getLearningProgress(library.id)).map((profile) => [profile.wordId, profile.state]))
    expect(replaced.map((word) => word.id)).toEqual([first.id, second.id])
    expect(progress.get(first.id)).toBe('weak')
    expect(progress.get(second.id)).toBe('familiar')
  })

  it('rejects incomplete rows instead of silently dropping them', async () => {
    await expect(createLibrary('不完整词库', [
      { english: 'Apple', chinese: '苹果' },
      { english: 'Book', chinese: '' },
    ])).rejects.toThrow('第 2 条词目缺少英文或中文')
    expect(await getLibraries()).toEqual([])
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
