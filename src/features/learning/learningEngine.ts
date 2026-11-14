import type { ReviewRating, WordEntry, WordLearningProfile, WordLearningStatus } from '../../types/domain'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export function createDefaultLearningProfile(word: Pick<WordEntry, 'id' | 'libraryId'>, now = Date.now()): WordLearningProfile {
  return {
    wordId: word.id,
    libraryId: word.libraryId,
    status: 'unlearned',
    statusSource: 'system',
    correctCount: 0,
    incorrectCount: 0,
    consecutiveCorrect: 0,
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.3,
    lastPracticedAt: null,
    lastIncorrectAt: null,
    nextReviewAt: null,
    updatedAt: now,
  }
}

/**
 * Matching is a recognition exercise, so its initial grade is deliberately conservative.
 * A user's end-of-round confidence rating then schedules the next review.
 */
export function applyPracticeOutcome(
  profile: WordLearningProfile,
  outcome: { misses: number; rating: ReviewRating },
  now = Date.now(),
): WordLearningProfile {
  const misses = Math.max(0, Math.floor(outcome.misses))
  const next: WordLearningProfile = {
    ...profile,
    correctCount: profile.correctCount + (misses === 0 ? 1 : 0),
    incorrectCount: profile.incorrectCount + misses,
    consecutiveCorrect: misses === 0 ? profile.consecutiveCorrect : 0,
    lastPracticedAt: now,
    lastIncorrectAt: misses > 0 ? now : profile.lastIncorrectAt,
    statusSource: 'system',
    updatedAt: now,
  }

  if (misses > 0) {
    next.consecutiveCorrect = 0
    next.status = 'learning'
    next.repetitions = 0
    next.intervalDays = 0
    next.easeFactor = Math.max(1.3, profile.easeFactor - 0.2)
    next.nextReviewAt = now + 15 * MINUTE
  }

  return applyReviewRating(next, outcome.rating, now, { allowIntervalGrowth: misses === 0 && (profile.nextReviewAt === null || now >= profile.nextReviewAt) })
}

export function applyReviewRating(
  profile: WordLearningProfile,
  rating: ReviewRating,
  now = Date.now(),
  options: { allowIntervalGrowth?: boolean } = {},
): WordLearningProfile {
  const allowIntervalGrowth = options.allowIntervalGrowth ?? (profile.nextReviewAt === null || now >= profile.nextReviewAt)
  const next = { ...profile, statusSource: 'system' as const, updatedAt: now }

  if (rating === 'forgotten') {
    next.status = 'learning'
    next.consecutiveCorrect = 0
    next.repetitions = 0
    next.intervalDays = 0
    next.easeFactor = Math.max(1.3, profile.easeFactor - 0.2)
    next.nextReviewAt = now + 15 * MINUTE
    return next
  }

  if (rating === 'uncertain') {
    next.status = 'fuzzy'
    next.consecutiveCorrect = 0
    next.repetitions = Math.max(0, profile.repetitions - 1)
    next.easeFactor = Math.max(1.3, profile.easeFactor - 0.08)
    next.nextReviewAt = now + Math.max(6 * 60 * MINUTE, Math.min(3 * DAY, profile.intervalDays * DAY * 0.5))
    return next
  }

  if (!allowIntervalGrowth) {
    next.status = profile.status === 'unlearned' ? 'learning' : profile.status
    next.consecutiveCorrect = profile.consecutiveCorrect
    next.nextReviewAt = profile.nextReviewAt ?? now + DAY
    return next
  }

  const repetitions = profile.repetitions + 1
  const intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 3 : Math.min(365, Math.max(3, profile.intervalDays * profile.easeFactor))
  next.repetitions = repetitions
  next.intervalDays = intervalDays
  next.easeFactor = Math.min(2.8, profile.easeFactor + 0.04)
  next.consecutiveCorrect = profile.consecutiveCorrect + 1
  next.nextReviewAt = now + intervalDays * DAY
  next.status = repetitions >= 5 && profile.intervalDays >= 14
    ? 'mastered'
    : repetitions >= 3
      ? 'familiar'
      : 'learning'
  return next
}

export function setManualLearningStatus(profile: WordLearningProfile, status: WordLearningStatus, now = Date.now()): WordLearningProfile {
  const next = { ...profile, status, statusSource: 'manual' as const, updatedAt: now }
  if (status === 'unlearned') {
    next.repetitions = 0
    next.consecutiveCorrect = 0
    next.intervalDays = 0
    next.nextReviewAt = null
  } else if (status === 'learning') {
    next.repetitions = 0
    next.consecutiveCorrect = 0
    next.intervalDays = 0
    next.nextReviewAt = now + 15 * MINUTE
  } else if (status === 'fuzzy') {
    next.nextReviewAt = now + 6 * 60 * MINUTE
  } else if (status === 'familiar') {
    next.repetitions = Math.max(3, next.repetitions)
    next.intervalDays = Math.max(3, next.intervalDays)
    next.nextReviewAt = now + Math.max(3, next.intervalDays) * DAY
  } else {
    next.repetitions = Math.max(5, next.repetitions)
    next.intervalDays = Math.max(14, next.intervalDays)
    next.nextReviewAt = now + Math.max(14, next.intervalDays) * DAY
  }
  return next
}

export const LEARNING_STATUS_LABELS: Record<WordLearningStatus, string> = {
  unlearned: '未学习',
  learning: '学习中',
  fuzzy: '模糊',
  familiar: '熟悉',
  mastered: '已掌握',
}
