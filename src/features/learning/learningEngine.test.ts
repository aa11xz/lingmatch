import { describe, expect, it } from 'vitest'
import { applyPracticeOutcome, createDefaultLearningProfile, setManualLearningStatus } from './learningEngine'
import type { WordEntry, WordLearningProfile } from '../../types/domain'

const DAY = 24 * 60 * 60 * 1000
const word: WordEntry = { id: 'word-1', libraryId: 'library-1', english: 'apple', chinese: '苹果', createdAt: 1 }

describe('learningEngine', () => {
  it('starts words as unlearned and does not equate one correct match with mastery', () => {
    const initial = createDefaultLearningProfile(word, 100)
    const practiced = applyPracticeOutcome(initial, { misses: 0, rating: 'remembered' }, 200)

    expect(initial.status).toBe('unlearned')
    expect(practiced.status).toBe('learning')
    expect(practiced.repetitions).toBe(1)
    expect(practiced.intervalDays).toBe(1)
    expect(practiced.nextReviewAt).toBe(200 + DAY)
    expect(practiced.statusSource).toBe('system')
  })

  it('extends intervals only after due reviews and reaches mastery after spaced successes', () => {
    let profile: WordLearningProfile = createDefaultLearningProfile(word, 0)
    let now = 1_000
    for (let repetition = 0; repetition < 5; repetition += 1) {
      profile = applyPracticeOutcome(profile, { misses: 0, rating: 'remembered' }, now)
      if (repetition < 4) {
        const priorInterval = profile.intervalDays
        profile = applyPracticeOutcome(profile, { misses: 0, rating: 'remembered' }, now + 1)
        expect(profile.intervalDays).toBe(priorInterval)
      }
      now = (profile.nextReviewAt ?? now) + 1
    }

    expect(profile.status).toBe('mastered')
    expect(profile.repetitions).toBe(5)
    expect(profile.intervalDays).toBeGreaterThanOrEqual(14)
  })

  it('schedules forgotten and uncertain feedback soon, and reopens a mastered word after an error', () => {
    const mastered = setManualLearningStatus(createDefaultLearningProfile(word, 0), 'mastered', 1_000)
    const forgotten = applyPracticeOutcome(mastered, { misses: 1, rating: 'forgotten' }, 2_000)
    const uncertain = applyPracticeOutcome(mastered, { misses: 0, rating: 'uncertain' }, 2_000)

    expect(forgotten.status).toBe('learning')
    expect(forgotten.consecutiveCorrect).toBe(0)
    expect(forgotten.nextReviewAt).toBe(2_000 + 15 * 60 * 1000)
    expect(uncertain.status).toBe('fuzzy')
    expect(uncertain.nextReviewAt).toBe(2_000 + 3 * DAY)
  })

  it('keeps manual status until a new answer updates the profile', () => {
    const manual = setManualLearningStatus(createDefaultLearningProfile(word, 0), 'familiar', 10_000)
    const practiced = applyPracticeOutcome(manual, { misses: 1, rating: 'uncertain' }, 20_000)

    expect(manual.status).toBe('familiar')
    expect(manual.statusSource).toBe('manual')
    expect(practiced.status).toBe('fuzzy')
    expect(practiced.statusSource).toBe('system')
    expect(practiced.incorrectCount).toBe(1)
  })
})
