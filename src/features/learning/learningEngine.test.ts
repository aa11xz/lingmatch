import { describe, expect, it } from 'vitest'
import type { WordEntry, WordProgress } from '../../types/domain'
import { applyPracticeOutcome, createDefaultWordProgress } from './learningEngine'

const DAY = 24 * 60 * 60 * 1000
const word: WordEntry = { id: 'word-1', libraryId: 'library-1', english: 'apple', chinese: '苹果', createdAt: 1 }

describe('learningEngine', () => {
  it('starts each word in new and moves it into learning after its first clean session', () => {
    const initial = createDefaultWordProgress(word, 100)
    const practiced = applyPracticeOutcome(initial, { mistakes: 0, firstTryCorrect: true }, 200)

    expect(initial).toEqual({
      wordId: word.id,
      libraryId: word.libraryId,
      state: 'new',
      correctSessions: 0,
      wrongSessions: 0,
      consecutiveCorrect: 0,
      lastPracticedAt: null,
      lastWrongAt: null,
      nextReviewAt: null,
      updatedAt: 100,
    })
    expect(practiced).toMatchObject({
      state: 'learning',
      correctSessions: 1,
      wrongSessions: 0,
      consecutiveCorrect: 1,
      lastPracticedAt: 200,
      nextReviewAt: 200 + DAY,
    })
  })

  it('uses fixed spaced intervals and advances to familiar then mastered gradually', () => {
    let progress: WordProgress = createDefaultWordProgress(word, 0)
    let practicedAt = 1_000
    const expectedIntervals = [1, 3, 7, 14, 30]

    for (const [index, intervalDays] of expectedIntervals.entries()) {
      progress = applyPracticeOutcome(progress, { mistakes: 0, firstTryCorrect: true }, practicedAt)
      expect(progress.nextReviewAt).toBe(practicedAt + intervalDays * DAY)
      if (index < 2) expect(progress.state).toBe('learning')
      if (index === 2 || index === 3) expect(progress.state).toBe('familiar')
      if (index === 4) expect(progress.state).toBe('mastered')
      practicedAt = progress.nextReviewAt! + 1
    }
    expect(progress.correctSessions).toBe(5)
    expect(progress.consecutiveCorrect).toBe(5)
  })

  it('moves a word to weak on any mistake and returns it to learning after a clean reinforcement', () => {
    const learning = {
      ...createDefaultWordProgress(word, 0),
      state: 'familiar' as const,
      correctSessions: 4,
      consecutiveCorrect: 3,
      nextReviewAt: 5_000,
    }
    const missed = applyPracticeOutcome(learning, { mistakes: 2, firstTryCorrect: false }, 10_000)

    expect(missed).toMatchObject({
      state: 'weak',
      correctSessions: 4,
      wrongSessions: 1,
      consecutiveCorrect: 0,
      lastWrongAt: 10_000,
      nextReviewAt: 10_000 + 15 * 60 * 1000,
    })

    const corrected = applyPracticeOutcome(missed, { mistakes: 0, firstTryCorrect: true }, 11_000)
    expect(corrected.state).toBe('learning')
    expect(corrected.wrongSessions).toBe(1)
    expect(corrected.consecutiveCorrect).toBe(1)
    expect(corrected.lastWrongAt).toBe(10_000)
  })

  it('treats a failed first-try result as incorrect even when the mistake count is zero', () => {
    const failedFirstTry = applyPracticeOutcome(
      createDefaultWordProgress(word, 100),
      { mistakes: 0, firstTryCorrect: false },
      200,
    )

    expect(failedFirstTry).toMatchObject({
      state: 'weak',
      correctSessions: 0,
      wrongSessions: 1,
      consecutiveCorrect: 0,
      lastWrongAt: 200,
    })
  })

  it('does not advance the review interval for an early correct retry', () => {
    const progress: WordProgress = {
      ...createDefaultWordProgress(word, 0),
      state: 'learning',
      correctSessions: 1,
      consecutiveCorrect: 1,
      nextReviewAt: 50_000,
    }

    const earlyRetry = applyPracticeOutcome(progress, { mistakes: 0, firstTryCorrect: true }, 49_999)
    expect(earlyRetry.nextReviewAt).toBe(50_000)
    expect(earlyRetry.state).toBe('learning')
  })
})
