import type { StudyTaskMode, WordEntry, WordProgress } from '../../types/domain'

export function learningPriority(progress: WordProgress | undefined, now = Date.now()): number {
  if (!progress) return 3
  if (progress.nextReviewAt !== null && progress.nextReviewAt <= now) return 0
  if (progress.state === 'weak') return 1
  if (progress.state === 'learning') return 2
  if (progress.state === 'new') return 3
  if (progress.state === 'familiar') return 4
  return 5
}

/** One canonical candidate selector is shared by task creation and the dashboard. */
export function selectCandidateWordIds(input: {
  words: readonly WordEntry[]
  progress: readonly WordProgress[]
  mode: StudyTaskMode
  now?: number
  practicedWordIds?: ReadonlySet<string>
}): string[] {
  const now = input.now ?? Date.now()
  const progressById = new Map(input.progress.map((item) => [item.wordId, item]))
  const wordsById = new Map<string, WordEntry>()
  for (const word of input.words) {
    if (word.archivedAt === undefined && !wordsById.has(word.id)) wordsById.set(word.id, word)
  }
  const words = [...wordsById.values()]

  const eligible = words.filter((word) => {
    const progress = progressById.get(word.id)
    switch (input.mode) {
      case 'due':
        return progress?.nextReviewAt !== null && progress?.nextReviewAt !== undefined && progress.nextReviewAt <= now
      case 'weak':
        return progress?.state === 'weak'
      case 'new':
        return !input.practicedWordIds?.has(word.id)
          && (!progress || (progress.state === 'new' && progress.lastPracticedAt === null))
      case 'comprehensive':
        return true
    }
  })

  return eligible.sort((left, right) => {
    if (input.mode === 'comprehensive') {
      const priorityDifference = learningPriority(progressById.get(left.id), now) - learningPriority(progressById.get(right.id), now)
      if (priorityDifference) return priorityDifference
    }
    const leftProgress = progressById.get(left.id)
    const rightProgress = progressById.get(right.id)
    return (leftProgress?.nextReviewAt ?? Number.MAX_SAFE_INTEGER) - (rightProgress?.nextReviewAt ?? Number.MAX_SAFE_INTEGER)
      || (rightProgress?.lastWrongAt ?? 0) - (leftProgress?.lastWrongAt ?? 0)
      || (leftProgress?.lastPracticedAt ?? 0) - (rightProgress?.lastPracticedAt ?? 0)
      || left.createdAt - right.createdAt
      || left.id.localeCompare(right.id)
  }).map(({ id }) => id)
}

export function nextRoundWordIds(input: {
  plannedWordIds: readonly string[]
  completedWordIds: readonly string[]
  roundSize: number
}): string[] {
  const planned = [...new Set(input.plannedWordIds)]
  const completed = new Set(input.completedWordIds)
  return planned.filter((id) => !completed.has(id)).slice(0, Math.max(1, Math.floor(input.roundSize)))
}
