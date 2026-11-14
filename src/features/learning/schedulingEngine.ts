import type { StudyTaskMode, WordEntry, WordLearningProfile } from '../../types/domain'

const RECENT_ERROR_WINDOW = 3 * 24 * 60 * 60 * 1000

export function learningPriority(profile: WordLearningProfile | undefined, now = Date.now()): number {
  if (!profile) return 4
  if (profile.nextReviewAt !== null && profile.nextReviewAt <= now) return 0
  if (profile.lastIncorrectAt !== null && now - profile.lastIncorrectAt <= RECENT_ERROR_WINDOW) return 1
  if (profile.incorrectCount >= 2 && profile.incorrectCount >= profile.correctCount) return 2
  if (profile.status === 'learning' || profile.status === 'fuzzy') return 3
  if (profile.status === 'unlearned') return 4
  if (profile.status === 'familiar') return 5
  return 6
}

function isEligible(mode: StudyTaskMode, profile: WordLearningProfile | undefined, now: number): boolean {
  if (mode === 'all' || mode === 'mixed') return true
  if (mode === 'new') return !profile || profile.status === 'unlearned'
  if (mode === 'due') return Boolean(profile?.nextReviewAt !== null && profile?.nextReviewAt !== undefined && profile.nextReviewAt <= now)
  if (mode === 'wrong') return Boolean(profile && profile.status !== 'mastered' && (profile.status === 'learning' || profile.status === 'fuzzy' || profile.lastIncorrectAt !== null))
  return Boolean(profile && profile.status !== 'mastered' && profile.incorrectCount > 0)
}

export function planStudyWordIds(
  words: readonly WordEntry[],
  profiles: readonly WordLearningProfile[],
  mode: StudyTaskMode,
  targetCount: number,
  now = Date.now(),
): string[] {
  const byId = new Map(profiles.map((profile) => [profile.wordId, profile]))
  const target = Math.max(0, Math.floor(targetCount))
  const eligible = words
    .filter((word) => word.archivedAt === undefined && isEligible(mode, byId.get(word.id), now))
    .sort((left, right) => {
      const leftProfile = byId.get(left.id)
      const rightProfile = byId.get(right.id)
      const priorityDifference = learningPriority(leftProfile, now) - learningPriority(rightProfile, now)
      if (priorityDifference) return priorityDifference
      const nextDifference = (leftProfile?.nextReviewAt ?? Number.MAX_SAFE_INTEGER) - (rightProfile?.nextReviewAt ?? Number.MAX_SAFE_INTEGER)
      if (nextDifference) return nextDifference
      const incorrectDifference = (rightProfile?.incorrectCount ?? 0) - (leftProfile?.incorrectCount ?? 0)
      if (incorrectDifference) return incorrectDifference
      const lastPracticeDifference = (leftProfile?.lastPracticedAt ?? 0) - (rightProfile?.lastPracticedAt ?? 0)
      if (lastPracticeDifference) return lastPracticeDifference
      return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    })

  if (mode !== 'mixed') return eligible.slice(0, target).map(({ id }) => id)

  const isDue = (word: WordEntry) => {
    const nextReviewAt = byId.get(word.id)?.nextReviewAt
    return nextReviewAt !== null && nextReviewAt !== undefined && nextReviewAt <= now
  }
  const due = eligible.filter(isDue)
  const future = eligible.filter((word) => !isDue(word))
  const active = future.filter((word) => byId.get(word.id)?.status !== 'mastered')
  const mastered = future.filter((word) => byId.get(word.id)?.status === 'mastered')
  const masteredQuota = Math.min(
    3,
    Math.max(1, Math.ceil(Math.min(target, eligible.length) * 0.1)),
    Math.max(1, Math.ceil(mastered.length * 0.1)),
  )
  return [...due, ...active, ...mastered.slice(0, masteredQuota)]
    .slice(0, target)
    .map(({ id }) => id)
}

export function nextRoundWordIds(input: {
  plannedWordIds: readonly string[]
  completedWordIds: readonly string[]
  reviewQueueWordIds: readonly string[]
  reviewedWordIds: readonly string[]
  profiles: readonly WordLearningProfile[]
  roundSize: number
  now?: number
}): { wordIds: string[]; remainingReviewQueue: string[]; reviewedWordIds: string[] } {
  const profileById = new Map(input.profiles.map((profile) => [profile.wordId, profile]))
  const completed = new Set(input.completedWordIds)
  const reviewed = new Set(input.reviewedWordIds)
  const reviewQueue = [...new Set(input.reviewQueueWordIds)].filter((id) => !reviewed.has(id))
  const pendingReview = reviewQueue
    .sort((left, right) => learningPriority(profileById.get(left), input.now) - learningPriority(profileById.get(right), input.now))
    .slice(0, Math.max(1, input.roundSize))
  if (pendingReview.length) {
    const selected = new Set(pendingReview)
    return {
      wordIds: pendingReview,
      remainingReviewQueue: reviewQueue.filter((id) => !selected.has(id)),
      reviewedWordIds: [...reviewed, ...pendingReview],
    }
  }

  const pendingTargets = [...new Set(input.plannedWordIds)].filter((id) => !completed.has(id))
  const wordIds = pendingTargets.slice(0, Math.max(1, input.roundSize))
  return {
    wordIds,
    remainingReviewQueue: reviewQueue,
    reviewedWordIds: [...reviewed],
  }
}
