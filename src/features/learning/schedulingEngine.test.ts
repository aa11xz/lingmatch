import { describe, expect, it } from 'vitest'
import type { StudyTaskMode, WordEntry, WordProgress } from '../../types/domain'
import { createDefaultWordProgress } from './learningEngine'
import { nextRoundWordIds, selectCandidateWordIds } from './schedulingEngine'

const now = 10_000_000
const DAY = 24 * 60 * 60 * 1000
const makeWord = (id: string, createdAt = 1, overrides: Partial<WordEntry> = {}): WordEntry => ({
  id,
  libraryId: 'library-1',
  english: `word-${id}`,
  chinese: `词${id}`,
  createdAt,
  ...overrides,
})

function progressFor(word: WordEntry, overrides: Partial<WordProgress> = {}): WordProgress {
  return { ...createDefaultWordProgress(word, now), ...overrides }
}

function select(words: WordEntry[], progress: WordProgress[], mode: StudyTaskMode, extras: { now?: number; practicedWordIds?: ReadonlySet<string> } = {}) {
  return selectCandidateWordIds({ words, progress, mode, ...extras })
}

describe('schedulingEngine', () => {
  it('returns only due words, including a word due exactly at now and never filling with random words', () => {
    const words = ['past', 'now', 'future', 'unreviewed'].map((id, index) => makeWord(id, index))
    const progress = [
      progressFor(words[0]!, { state: 'familiar', nextReviewAt: now - 1 }),
      progressFor(words[1]!, { state: 'learning', nextReviewAt: now }),
      progressFor(words[2]!, { state: 'weak', nextReviewAt: now + 1 }),
    ]

    expect(select(words, progress, 'due', { now })).toEqual(['past', 'now'])
    expect(select([words[3]!], [], 'due', { now })).toEqual([])
  })

  it('uses current weak state as the only reinforcement criterion and drops recovered words', () => {
    const words = ['weak-now', 'recovered', 'never-practiced', 'archived'].map((id, index) => makeWord(id, index, {
      archivedAt: id === 'archived' ? now : undefined,
    }))
    const progress = [
      progressFor(words[0]!, { state: 'weak', wrongSessions: 8, correctSessions: 1 }),
      progressFor(words[1]!, { state: 'learning', wrongSessions: 3, correctSessions: 8, consecutiveCorrect: 2 }),
      progressFor(words[3]!, { state: 'weak', wrongSessions: 5 }),
    ]

    expect(select(words, progress, 'weak', { now })).toEqual(['weak-now'])
  })

  it('selects only never-practiced new words and reports all candidates regardless of round size', () => {
    const words = Array.from({ length: 80 }, (_, index) => makeWord(`new-${index}`, index))
    const practiced = new Set(['new-3', 'new-7'])
    const progress = [
      progressFor(words[1]!, { state: 'learning', lastPracticedAt: now - 1 }),
      progressFor(words[2]!, { state: 'new', lastPracticedAt: now - 1 }),
    ]

    const candidates = select(words, progress, 'new', { now, practicedWordIds: practiced })
    expect(candidates).toHaveLength(76)
    expect(candidates).not.toContain('new-1')
    expect(candidates).not.toContain('new-2')
    expect(candidates).not.toContain('new-3')
    expect(candidates).not.toContain('new-7')
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it('covers every valid word exactly once in comprehensive mode, ordered by current state priority', () => {
    const words = [
      makeWord('mastered', 0),
      makeWord('familiar', 1),
      makeWord('new', 2),
      makeWord('learning', 3),
      makeWord('weak', 4),
      makeWord('due', 5),
      makeWord('archived', 6, { archivedAt: now }),
    ]
    const progress = [
      progressFor(words[0]!, { state: 'mastered', nextReviewAt: now + DAY }),
      progressFor(words[1]!, { state: 'familiar', nextReviewAt: now + DAY }),
      progressFor(words[3]!, { state: 'learning', nextReviewAt: now + DAY }),
      progressFor(words[4]!, { state: 'weak', nextReviewAt: now + DAY }),
      progressFor(words[5]!, { state: 'familiar', nextReviewAt: now }),
    ]

    const plan = select(words, progress, 'comprehensive', { now })
    expect(plan).toEqual(['due', 'weak', 'learning', 'new', 'familiar', 'mastered'])
    expect(plan).toHaveLength(6)
    expect(new Set(plan).size).toBe(6)
  })

  it('deduplicates word IDs in a comprehensive snapshot and keeps stable sorting', () => {
    const first = makeWord('duplicate', 1)
    const duplicate = { ...first, english: 'replacement', createdAt: 2 }
    const words = [first, makeWord('other', 2), duplicate]

    const plan = select(words, [], 'comprehensive', { now })
    expect(plan).toEqual(['duplicate', 'other'])
    expect(new Set(plan).size).toBe(plan.length)
  })

  it('prepares the next round from the fixed plan without repeating completed IDs', () => {
    const planned = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(nextRoundWordIds({ plannedWordIds: planned, completedWordIds: ['a', 'b'], roundSize: 2 })).toEqual(['c', 'd'])
    expect(nextRoundWordIds({ plannedWordIds: planned, completedWordIds: planned, roundSize: 2 })).toEqual([])
    expect(nextRoundWordIds({ plannedWordIds: ['a', 'a', 'b'], completedWordIds: [], roundSize: 2 })).toEqual(['a', 'b'])
  })
})
