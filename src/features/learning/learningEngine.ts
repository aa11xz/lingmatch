import type { WordEntry, WordProgress, WordProgressState } from '../../types/domain'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const

export function createDefaultWordProgress(word: Pick<WordEntry, 'id' | 'libraryId'>, now = Date.now()): WordProgress {
  return {
    wordId: word.id,
    libraryId: word.libraryId,
    state: 'new',
    correctSessions: 0,
    wrongSessions: 0,
    consecutiveCorrect: 0,
    lastPracticedAt: null,
    lastWrongAt: null,
    nextReviewAt: null,
    updatedAt: now,
  }
}

/** Deterministic state transition based only on observable session outcomes. */
export function applyPracticeOutcome(
  progress: WordProgress,
  outcome: { mistakes: number; firstTryCorrect: boolean },
  now = Date.now(),
): WordProgress {
  const mistakes = Math.max(0, Math.floor(outcome.mistakes))
  const isIncorrect = mistakes > 0 || !outcome.firstTryCorrect
  const next: WordProgress = {
    ...progress,
    correctSessions: progress.correctSessions + (isIncorrect ? 0 : 1),
    wrongSessions: progress.wrongSessions + (isIncorrect ? 1 : 0),
    consecutiveCorrect: isIncorrect ? 0 : progress.consecutiveCorrect + 1,
    lastPracticedAt: now,
    lastWrongAt: isIncorrect ? now : progress.lastWrongAt,
    updatedAt: now,
  }

  if (isIncorrect) {
    next.state = 'weak'
    next.nextReviewAt = now + 15 * MINUTE
    return next
  }

  // Only a review reached on or after its due time counts as spaced evidence.
  const spacedReview = progress.nextReviewAt !== null && now >= progress.nextReviewAt
  const dueIndex = Math.min(Math.max(progress.correctSessions, 0), REVIEW_INTERVAL_DAYS.length - 1)
  if (progress.nextReviewAt === null || spacedReview) {
    next.nextReviewAt = now + (REVIEW_INTERVAL_DAYS[dueIndex] ?? REVIEW_INTERVAL_DAYS.at(-1)!) * DAY
  }

  if (progress.state === 'weak' || progress.state === 'new') {
    next.state = 'learning'
  } else if (spacedReview && next.correctSessions >= 5 && next.consecutiveCorrect >= 5) {
    next.state = 'mastered'
  } else if (spacedReview && next.correctSessions >= 3 && next.consecutiveCorrect >= 3) {
    next.state = 'familiar'
  } else {
    next.state = progress.state
  }
  return next
}

export const LEARNING_STATUS_LABELS: Record<WordProgressState, string> = {
  new: '未学习',
  learning: '学习中',
  weak: '薄弱',
  familiar: '熟悉',
  mastered: '已掌握',
}
