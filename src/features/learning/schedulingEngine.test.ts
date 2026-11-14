import { describe, expect, it } from 'vitest'
import type { StudyTaskMode, WordEntry, WordLearningProfile } from '../../types/domain'
import { createDefaultLearningProfile } from './learningEngine'
import { nextRoundWordIds, planStudyWordIds } from './schedulingEngine'

const now = 10_000_000
const DAY = 24 * 60 * 60 * 1000
const makeWord = (id: string, createdAt: number): WordEntry => ({
  id,
  libraryId: 'library-1',
  english: `word-${id}`,
  chinese: `词${id}`,
  createdAt,
})

function profileFor(word: WordEntry, overrides: Partial<WordLearningProfile> = {}): WordLearningProfile {
  return { ...createDefaultLearningProfile(word, 0), ...overrides }
}

describe('schedulingEngine', () => {
  it('prioritizes due reviews, then recent errors, weak and learning words', () => {
    const words = ['new', 'learning', 'weak', 'recent', 'due'].map((id, index) => makeWord(id, index))
    const profiles = [
      profileFor(words[1]!, { status: 'learning', lastPracticedAt: now - 100 }),
      profileFor(words[2]!, { status: 'fuzzy', incorrectCount: 3, correctCount: 1, lastIncorrectAt: now - 10 * 24 * 60 * 60 * 1000 }),
      profileFor(words[3]!, { status: 'learning', incorrectCount: 1, lastIncorrectAt: now - 60_000 }),
      profileFor(words[4]!, { status: 'familiar', nextReviewAt: now - 1 }),
    ]

    expect(planStudyWordIds(words, profiles, 'mixed', 5, now)).toEqual(['due', 'recent', 'weak', 'learning', 'new'])
  })

  it.each<[StudyTaskMode, string[]]>([
    ['new', ['new']],
    ['due', ['due']],
    ['wrong', ['wrong']],
    ['weak', ['wrong']],
  ])('filters %s tasks without hiding pending words', (mode, expected) => {
    const words = ['new', 'wrong', 'due', 'mastered'].map((id, index) => makeWord(id, index))
    const profiles = [
      profileFor(words[1]!, { status: 'learning', incorrectCount: 1, lastIncorrectAt: now - 1 }),
      profileFor(words[2]!, { status: 'familiar', nextReviewAt: now - 1 }),
      profileFor(words[3]!, { status: 'mastered', incorrectCount: 4, lastIncorrectAt: now - 1 }),
    ]

    expect(planStudyWordIds(words, profiles, mode, 20, now)).toEqual(expected)
  })

  it('covers all eligible new words even when the requested task is larger than the library', () => {
    const words = [makeWord('a', 1), makeWord('b', 2), makeWord('c', 3)]
    const selected = planStudyWordIds(words, [], 'all', 50, now)
    expect(selected).toHaveLength(3)
    expect(new Set(selected)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('samples only a small number of mastered words in mixed practice while all mode includes every word', () => {
    const words = Array.from({ length: 8 }, (_, index) => makeWord(`mastered-${index}`, index))
    const profiles = words.map((word, index) => profileFor(word, {
      status: 'mastered',
      repetitions: 5,
      intervalDays: 14,
      lastPracticedAt: now - index * DAY,
      nextReviewAt: now + DAY,
    }))

    expect(planStudyWordIds(words, profiles, 'mixed', 50, now)).toHaveLength(1)
    expect(planStudyWordIds(words, profiles, 'all', 50, now)).toHaveLength(8)
  })

  it('retries a missed word once, then advances through planned words without looping', () => {
    const words = ['a', 'b', 'c'].map((id, index) => makeWord(id, index))
    const retryProfile = profileFor(words[0]!, { status: 'learning', incorrectCount: 1, lastIncorrectAt: now })
    const retryRound = nextRoundWordIds({
      plannedWordIds: ['a', 'b', 'c'],
      completedWordIds: ['a'],
      reviewQueueWordIds: ['a'],
      reviewedWordIds: [],
      profiles: [retryProfile],
      roundSize: 2,
      now,
    })
    expect(retryRound.wordIds).toEqual(['a'])
    expect(retryRound.reviewedWordIds).toEqual(['a'])

    const nextTargetRound = nextRoundWordIds({
      plannedWordIds: ['a', 'b', 'c'],
      completedWordIds: ['a'],
      reviewQueueWordIds: [],
      reviewedWordIds: retryRound.reviewedWordIds,
      profiles: [retryProfile],
      roundSize: 2,
      now,
    })
    expect(nextTargetRound.wordIds).toEqual(['b', 'c'])

    const noLoop = nextRoundWordIds({
      plannedWordIds: ['a', 'b', 'c'],
      completedWordIds: ['a', 'b', 'c'],
      reviewQueueWordIds: ['a'],
      reviewedWordIds: retryRound.reviewedWordIds,
      profiles: [retryProfile],
      roundSize: 2,
      now,
    })
    expect(noLoop.wordIds).toEqual([])
  })
})
