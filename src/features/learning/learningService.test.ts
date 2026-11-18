import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { createLibrary, listWords } from '../library/libraryService'
import { createDefaultWordProgress } from './learningEngine'
import {
  completeStudyRound,
  createStudyTask,
  getCandidateWordIds,
  getCurrentStudyTask,
  getLearningDashboard,
  getLearningProgress,
  getPausedStudyTasks,
  getUnfinishedStudyTasks,
  getWordPracticeHistory,
  pauseStudyTask,
  recordPairResolution,
  resumeStudyTask,
} from './learningService'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterAll(() => db.close())

async function finishRound(taskId: string, task: { roundNumber: number; currentRoundWordIds: string[] }, timestamp: number) {
  for (const wordId of task.currentRoundWordIds) {
    await recordPairResolution({ taskId, roundNumber: task.roundNumber, englishWordId: wordId, chineseWordId: wordId, correct: true })
  }
  return completeStudyRound({ taskId, roundNumber: task.roundNumber, durationSeconds: 1, timestamp })
}

function progressFor(wordId: string, libraryId: string, overrides: Partial<ReturnType<typeof createDefaultWordProgress>> = {}) {
  return { ...createDefaultWordProgress({ id: wordId, libraryId }, 1), ...overrides }
}

describe('learning candidate selection and dashboard', () => {
  it('uses current progress for due and weak candidates and returns the same counts in Dashboard', async () => {
    const library = await createLibrary('状态统计', Array.from({ length: 12 }, (_, index) => ({ english: `word-${index}`, chinese: `释义${index}` })))
    const words = await listWords(library.id)
    const now = 10_000
    await db.wordProgress.bulkPut([
      progressFor(words[0]!.id, library.id, { state: 'familiar', nextReviewAt: now }),
      progressFor(words[1]!.id, library.id, { state: 'weak', wrongSessions: 3, lastWrongAt: now - 5 }),
      progressFor(words[2]!.id, library.id, { state: 'learning', correctSessions: 2, nextReviewAt: now + 1 }),
      progressFor(words[3]!.id, library.id, { state: 'familiar', nextReviewAt: now + 1 }),
      progressFor(words[4]!.id, library.id, { state: 'mastered', nextReviewAt: now + 1 }),
      progressFor(words[5]!.id, library.id, { state: 'new', lastPracticedAt: now - 1 }),
    ])
    await db.practiceEvents.add({
      id: 'historical-error', wordId: words[5]!.id, libraryId: library.id, taskId: 'old-task',
      roundId: 'old-task:round:1', mode: 'comprehensive', mistakes: 1, firstTryCorrect: false, practicedAt: now - 1,
    })

    expect(await getCandidateWordIds(library.id, 'due', now)).toEqual([words[0]!.id])
    expect(await getCandidateWordIds(library.id, 'weak', now)).toEqual([words[1]!.id])
    const dashboard = await getLearningDashboard(library.id, now)
    expect(dashboard.stats).toMatchObject({ total: 12, new: 6, weak: 1, due: 1 })
    expect(dashboard.candidateWordCounts).toEqual({ due: 1, weak: 1, new: 6, comprehensive: 12 })
    expect(dashboard.candidateWordCounts.comprehensive).toBe(12)
    expect(dashboard.weak).toBe((await getCandidateWordIds(library.id, 'weak', now)).length)
    expect(dashboard.new).toBe((await getCandidateWordIds(library.id, 'new', now)).length)
  })

  it('does not treat an old error event as current weakness after progress recovers', async () => {
    const library = await createLibrary('历史与当前状态', [{ english: 'apple', chinese: '苹果' }])
    const [word] = await listWords(library.id)
    await db.wordProgress.put(progressFor(word!.id, library.id, {
      state: 'learning', correctSessions: 4, wrongSessions: 1, consecutiveCorrect: 3,
      lastPracticedAt: 9_000, lastWrongAt: 1_000, nextReviewAt: 20_000,
    }))
    await db.practiceEvents.add({
      id: 'old-error', wordId: word!.id, libraryId: library.id, taskId: 'old-task',
      roundId: 'old-task:round:1', mode: 'comprehensive', mistakes: 2, firstTryCorrect: false, practicedAt: 1_000,
    })

    expect(await getCandidateWordIds(library.id, 'weak', 10_000)).toEqual([])
    expect(await getWordPracticeHistory(word!.id)).toHaveLength(1)
    expect((await db.practiceEvents.get('old-error'))?.mistakes).toBe(2)
  })

  it('caps a new task at its requested daily amount while the candidate count remains uncapped', async () => {
    const library = await createLibrary('每日新词', Array.from({ length: 60 }, (_, index) => ({ english: `word-${index}`, chinese: `释义${index}` })))
    const dashboard = await getLearningDashboard(library.id, 1_000)
    const task = await createStudyTask({ libraryId: library.id, mode: 'new', targetCount: 50, roundSize: 10, timestamp: 1_000 })

    expect(dashboard.candidateWordCounts.new).toBe(60)
    expect(task.task.plannedWordIds).toHaveLength(50)
    expect(new Set(task.task.plannedWordIds).size).toBe(50)
  })

  it('plans all 598 unique valid words in comprehensive mode and keeps the plan fixed across rounds', async () => {
    const library = await createLibrary('598词全覆盖', Array.from({ length: 598 }, (_, index) => ({ english: `word-${index}`, chinese: `释义${index}` })))
    const words = await listWords(library.id)
    const task = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 10, timestamp: 2_000 })

    expect(task.task.plannedWordIds).toHaveLength(598)
    expect(new Set(task.task.plannedWordIds).size).toBe(598)
    expect(task.task.plannedWordIds).toEqual(words.map((word) => word.id))
    expect(task.task.currentRoundWordIds).toEqual(task.task.plannedWordIds.slice(0, 10))

    const round = await finishRound(task.task.id, task.task, 3_000)
    expect(round.task.completedWordIds).toEqual(task.task.plannedWordIds.slice(0, 10))
    expect(round.task.plannedWordIds).toHaveLength(598)
    expect(round.task.currentRoundWordIds).toEqual(task.task.plannedWordIds.slice(10, 20))
    expect((await getLearningDashboard(library.id, 3_000)).candidateWordCounts.comprehensive).toBe(598)
  })
})

describe('study task lifecycle and consistency', () => {
  it('reuses one paused task for a mode and switches modes without losing the fixed snapshot', async () => {
    const library = await createLibrary('模式切换', Array.from({ length: 12 }, (_, index) => ({ english: `word-${index}`, chinese: `释义${index}` })))
    let first = (await createStudyTask({ libraryId: library.id, mode: 'new', targetCount: 8, roundSize: 4, timestamp: 1_000 })).task
    first = (await finishRound(first.id, first, 1_100)).task
    expect(first.completedWordIds).toHaveLength(4)

    await pauseStudyTask(first.id)
    const resumed = await createStudyTask({ libraryId: library.id, mode: 'new', targetCount: 8, roundSize: 4, timestamp: 1_200 })
    expect(resumed.task.id).toBe(first.id)
    expect(resumed.task.completedWordIds).toEqual(first.completedWordIds)
    expect(resumed.task.plannedWordIds).toEqual(first.plannedWordIds)

    const comprehensive = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4, timestamp: 1_300 })
    expect(comprehensive.task.status).toBe('in-progress')
    expect(await db.studyTasks.get(first.id)).toMatchObject({ status: 'paused', completedWordIds: first.completedWordIds })
    expect(await getCurrentStudyTask(library.id)).toMatchObject({ id: comprehensive.task.id })

    await pauseStudyTask(comprehensive.task.id)
    const restored = await resumeStudyTask(first.id)
    expect(restored.task.id).toBe(first.id)
    expect(restored.task.currentRoundWordIds).toEqual(first.currentRoundWordIds)
    expect((await getPausedStudyTasks(library.id)).map((task) => task.id)).toEqual([comprehensive.task.id])
  })

  it('refuses to create duplicate unfinished tasks within one mode and allows a new task after completion', async () => {
    const library = await createLibrary('同模式唯一', [{ english: 'one', chinese: '一' }])
    const first = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4, timestamp: 2_000 })
    const duplicate = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4, timestamp: 2_100 })
    expect(duplicate.task.id).toBe(first.task.id)
    expect(await db.studyTasks.count()).toBe(1)

    const completed = await finishRound(first.task.id, first.task, 2_200)
    expect(completed.task.status).toBe('completed')
    expect((await getUnfinishedStudyTasks(library.id)).map((task) => task.id)).toEqual([])
    const next = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4, timestamp: 2_300 })
    expect(next.task.id).not.toBe(first.task.id)
    expect(await db.studyTasks.count()).toBe(2)
  })

  it('records each round once, updates progress with history atomically, and does not retry misses in the same task', async () => {
    const library = await createLibrary('事务与事件', [
      { english: 'apple', chinese: '苹果' },
      { english: 'book', chinese: '书' },
    ])
    const words = await listWords(library.id)
    const task = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4, timestamp: 3_000 })
    const first = words[0]!
    const second = words[1]!

    await recordPairResolution({ taskId: task.task.id, roundNumber: 1, englishWordId: first.id, chineseWordId: second.id, correct: false })
    await recordPairResolution({ taskId: task.task.id, roundNumber: 1, englishWordId: first.id, chineseWordId: first.id, correct: true })
    await recordPairResolution({ taskId: task.task.id, roundNumber: 1, englishWordId: second.id, chineseWordId: second.id, correct: true })
    const result = await completeStudyRound({ taskId: task.task.id, roundNumber: 1, durationSeconds: 8, timestamp: 3_100 })

    expect(result.task.status).toBe('completed')
    expect(result.task.completedWordIds).toEqual(task.task.plannedWordIds)
    expect(result.task.currentRoundWordIds).toEqual([])
    expect(await db.practiceEvents.count()).toBe(2)
    expect(await db.results.count()).toBe(1)
    expect(await db.practiceEvents.get(`${task.task.id}:round:1:${first.id}`)).toMatchObject({
      mistakes: 1, firstTryCorrect: false, mode: 'comprehensive',
    })
    expect(await db.wordProgress.get(first.id)).toMatchObject({ state: 'weak', wrongSessions: 1, consecutiveCorrect: 0 })
    expect(await getCandidateWordIds(library.id, 'weak', 3_101)).toContain(first.id)
    expect(await getLearningProgress(library.id)).toHaveLength(2)

    await expect(completeStudyRound({ taskId: task.task.id, roundNumber: 1, durationSeconds: 8, timestamp: 3_200 })).rejects.toThrow()
    expect(await db.practiceEvents.count()).toBe(2)
    expect(await db.results.count()).toBe(1)
  })

  it('rejects a duplicate round-word event by semantic identity even when the event ID differs', async () => {
    const library = await createLibrary('事务回滚', [{ english: 'apple', chinese: '苹果' }])
    const [word] = await listWords(library.id)
    const task = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4, timestamp: 4_000 })
    await recordPairResolution({ taskId: task.task.id, roundNumber: 1, englishWordId: word!.id, chineseWordId: word!.id, correct: true })
    const originalProgress = await db.wordProgress.get(word!.id)
    await db.practiceEvents.add({
      id: 'semantic-collision-with-another-id', wordId: word!.id, libraryId: library.id,
      taskId: task.task.id, roundId: `${task.task.id}:round:1`, mode: 'comprehensive',
      mistakes: 0, firstTryCorrect: true, practicedAt: 1,
    })

    await expect(completeStudyRound({ taskId: task.task.id, roundNumber: 1, durationSeconds: 1, timestamp: 4_100 }))
      .rejects.toThrow('练习记录')
    expect(await db.wordProgress.get(word!.id)).toEqual(originalProgress)
    expect(await db.results.count()).toBe(0)
    expect(await db.studyTasks.get(task.task.id)).toMatchObject({ status: 'in-progress', completedWordIds: [] })
    expect(await db.practiceEvents.count()).toBe(1)
  })

  it('rolls back progress and task changes when a different semantic event collides on primary ID', async () => {
    const library = await createLibrary('主键冲突事务回滚', [{ english: 'apple', chinese: '苹果' }])
    const [word] = await listWords(library.id)
    const task = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4, timestamp: 4_500 })
    await recordPairResolution({ taskId: task.task.id, roundNumber: 1, englishWordId: word!.id, chineseWordId: word!.id, correct: true })
    const originalProgress = await db.wordProgress.get(word!.id)
    await db.practiceEvents.add({
      id: `${task.task.id}:round:1:${word!.id}`, wordId: word!.id, libraryId: library.id,
      taskId: 'different-task', roundId: 'different-task:round:1', mode: 'comprehensive',
      mistakes: 0, firstTryCorrect: true, practicedAt: 1,
    })

    await expect(completeStudyRound({ taskId: task.task.id, roundNumber: 1, durationSeconds: 1, timestamp: 4_600 })).rejects.toThrow()
    expect(await db.wordProgress.get(word!.id)).toEqual(originalProgress)
    expect(await db.results.count()).toBe(0)
    expect(await db.studyTasks.get(task.task.id)).toMatchObject({ status: 'in-progress', completedWordIds: [] })
    expect(await db.practiceEvents.count()).toBe(1)
  })

  it('keeps pair resolution idempotent and forbids matching a word twice in one round', async () => {
    const library = await createLibrary('配对幂等', [
      { english: 'apple', chinese: '苹果' },
      { english: 'book', chinese: '书' },
    ])
    const words = await listWords(library.id)
    const task = await createStudyTask({ libraryId: library.id, mode: 'comprehensive', roundSize: 4 })
    const first = await recordPairResolution({ taskId: task.task.id, roundNumber: 1, englishWordId: words[0]!.id, chineseWordId: words[0]!.id, correct: true })
    const duplicate = await recordPairResolution({ taskId: task.task.id, roundNumber: 1, englishWordId: words[0]!.id, chineseWordId: words[0]!.id, correct: true })
    expect(duplicate.currentMatchedWordIds).toEqual(first.currentMatchedWordIds)
    expect(duplicate.currentMatchedWordIds).toEqual([words[0]!.id])
    await expect(recordPairResolution({ taskId: task.task.id, roundNumber: 1, englishWordId: words[0]!.id, chineseWordId: words[1]!.id, correct: false }))
      .resolves.toMatchObject({ currentMatchedWordIds: [words[0]!.id] })
  })
})
