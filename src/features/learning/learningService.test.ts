import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { createLibrary, listWords } from '../library/libraryService'
import {
  completeStudyRound,
  createStudyTask,
  getLearningProfiles,
  getResumableStudyTask,
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

describe('learning task persistence', () => {
  it('records per-word outcomes atomically and schedules a missed word once for reinforcement', async () => {
    const library = await createLibrary('学习任务', [
      { english: 'Apple', chinese: '苹果' },
      { english: 'Book', chinese: '书' },
      { english: 'Cloud', chinese: '云' },
    ])
    const words = await listWords(library.id)
    const firstTimestamp = 10_000
    const bundle = await createStudyTask({
      libraryId: library.id,
      mode: 'all',
      targetCount: 50,
      roundSize: 4,
      timestamp: firstTimestamp,
    })
    expect(bundle.task.plannedWordIds).toHaveLength(3)
    expect(bundle.task.currentRoundWordIds).toHaveLength(3)

    await recordPairResolution({
      taskId: bundle.task.id,
      roundNumber: 1,
      englishWordId: words[0]!.id,
      chineseWordId: words[1]!.id,
      correct: false,
    })
    for (const word of words) {
      await recordPairResolution({
        taskId: bundle.task.id,
        roundNumber: 1,
        englishWordId: word.id,
        chineseWordId: word.id,
        correct: true,
      })
    }

    const firstRound = await completeStudyRound({
      taskId: bundle.task.id,
      roundNumber: 1,
      ratings: {
        [words[0]!.id]: 'forgotten',
        [words[1]!.id]: 'uncertain',
        [words[2]!.id]: 'remembered',
      },
      durationSeconds: 35,
      timestamp: firstTimestamp,
    })
    expect(firstRound.task.roundNumber).toBe(2)
    expect(firstRound.task.currentRoundWordIds).toHaveLength(2)
    expect(firstRound.task.currentRoundWordIds).toContain(words[0]!.id)
    expect(firstRound.task.currentRoundWordIds).toContain(words[1]!.id)
    expect(firstRound.task.reviewedWordIds).toHaveLength(2)

    for (const wordId of firstRound.task.currentRoundWordIds) {
      await recordPairResolution({
        taskId: bundle.task.id,
        roundNumber: 2,
        englishWordId: wordId,
        chineseWordId: wordId,
        correct: true,
      })
    }
    const finalRound = await completeStudyRound({
      taskId: bundle.task.id,
      roundNumber: 2,
      ratings: Object.fromEntries(firstRound.task.currentRoundWordIds.map((wordId) => [wordId, 'remembered'])),
      durationSeconds: 18,
      timestamp: firstTimestamp + 2_000,
    })

    expect(finalRound.task.status).toBe('completed')
    expect(finalRound.task.completedWordIds).toHaveLength(3)
    expect(finalRound.task.totalMistakes).toBe(1)
    expect(await db.results.count()).toBe(2)
    expect(await db.practiceEvents.count()).toBe(5)
    expect(await getLearningProfiles(library.id)).toHaveLength(3)
    expect((await getWordPracticeHistory(words[0]!.id)).map((event) => event.practicedAt)).toEqual([
      firstTimestamp + 2_000,
      firstTimestamp,
    ])
  })

  it('restores an interrupted round including resolved pairs and mistakes', async () => {
    const library = await createLibrary('断点恢复', [
      { english: 'River', chinese: '河流' },
      { english: 'Forest', chinese: '森林' },
    ])
    const words = await listWords(library.id)
    const bundle = await createStudyTask({ libraryId: library.id, mode: 'all', targetCount: 10, roundSize: 4 })

    await recordPairResolution({
      taskId: bundle.task.id,
      roundNumber: 1,
      englishWordId: words[0]!.id,
      chineseWordId: words[0]!.id,
      correct: true,
    })
    await recordPairResolution({
      taskId: bundle.task.id,
      roundNumber: 1,
      englishWordId: words[0]!.id,
      chineseWordId: words[1]!.id,
      correct: false,
    })
    await pauseStudyTask(bundle.task.id)

    const resumed = await resumeStudyTask(bundle.task.id)
    expect(resumed.task.currentMatchedWordIds).toContain(words[0]!.id)
    expect(resumed.task.currentMissesByWord).toMatchObject({ [words[0]!.id]: 1, [words[1]!.id]: 1 })
    expect(resumed.words.map((word) => word.id)).toEqual(bundle.task.currentRoundWordIds)
  })

  it('keeps resumable tasks available per library and prevents hidden duplicate tasks', async () => {
    const firstLibrary = await createLibrary('第一词库', [{ english: 'River', chinese: '河流' }])
    const secondLibrary = await createLibrary('第二词库', [{ english: 'Forest', chinese: '森林' }])
    const firstTask = await createStudyTask({ libraryId: firstLibrary.id, mode: 'all', roundSize: 4, timestamp: 100 })
    const secondTask = await createStudyTask({ libraryId: secondLibrary.id, mode: 'all', roundSize: 4, timestamp: 200 })

    await expect(createStudyTask({ libraryId: firstLibrary.id, mode: 'new', roundSize: 4, timestamp: 300 }))
      .rejects.toThrow('还有一项未完成的学习任务')
    expect((await getResumableStudyTask(firstLibrary.id))?.id).toBe(firstTask.task.id)
    expect((await getResumableStudyTask(secondLibrary.id))?.id).toBe(secondTask.task.id)
    expect((await getResumableStudyTask())?.id).toBe(secondTask.task.id)
  })
})
