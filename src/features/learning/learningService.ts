import { db } from '../../db/database'
import { applyPracticeOutcome, createDefaultLearningProfile, setManualLearningStatus } from './learningEngine'
import { nextRoundWordIds, planStudyWordIds } from './schedulingEngine'
import type {
  GameResult,
  LearningStats,
  PairCount,
  PracticeEvent,
  PracticeMode,
  ReviewRating,
  StudyTask,
  StudyTaskMode,
  WordEntry,
  WordLearningProfile,
  WordLearningStatus,
} from '../../types/domain'

export interface StudyTaskBundle {
  task: StudyTask
  words: WordEntry[]
}

export interface CompletedRoundResult extends StudyTaskBundle {
  result: GameResult
}

const now = () => Date.now()
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const roundId = (taskId: string, roundNumber: number) => `${taskId}:round:${roundNumber}`

async function getTaskWords(ids: readonly string[]): Promise<WordEntry[]> {
  const rows = await db.words.bulkGet([...new Set(ids)])
  const byId = new Map(rows.filter((word): word is WordEntry => Boolean(word)).map((word) => [word.id, word]))
  return ids.flatMap((id) => {
    const word = byId.get(id)
    return word ? [word] : []
  })
}

export async function createStudyTask(input: {
  libraryId: string
  mode?: StudyTaskMode
  practiceMode?: PracticeMode
  targetCount?: number
  roundSize: PairCount
  timestamp?: number
}): Promise<StudyTaskBundle> {
  const timestamp = input.timestamp ?? now()
  const mode = input.mode ?? 'mixed'
  const task = await db.transaction('rw', db.words, db.learningProfiles, db.studyTasks, async () => {
    const existingTask = await db.studyTasks.where('libraryId').equals(input.libraryId).filter((candidate) => candidate.status !== 'completed').first()
    if (existingTask) throw new Error('这个词库还有一项未完成的学习任务，请先继续完成后再开始新任务。')
    const words = (await db.words.where('libraryId').equals(input.libraryId).toArray()).filter((word) => word.archivedAt === undefined)
    if (!words.length) throw new Error('这个词库没有可练习的词条。')

    const existingProfiles = await db.learningProfiles.where('libraryId').equals(input.libraryId).toArray()
    const profilesById = new Map(existingProfiles.map((profile) => [profile.wordId, profile]))
    const missingProfiles = words.filter((word) => !profilesById.has(word.id)).map((word) => createDefaultLearningProfile(word, timestamp))
    if (missingProfiles.length) await db.learningProfiles.bulkAdd(missingProfiles)
    const profiles = [...existingProfiles, ...missingProfiles]
    const targetCount = Math.max(1, Math.floor(input.targetCount ?? 50))
    const plannedWordIds = planStudyWordIds(words, profiles, mode, targetCount, timestamp)
    if (!plannedWordIds.length) {
      const message = mode === 'new' ? '这个词库暂时没有未学习的新词。' : mode === 'due' ? '现在没有到期的复习词。' : '当前筛选没有可练习的单词。'
      throw new Error(message)
    }

    const currentRoundWordIds = plannedWordIds.slice(0, input.roundSize)
    const created: StudyTask = {
      id: makeId(),
      libraryId: input.libraryId,
      mode,
      practiceMode: input.practiceMode ?? 'match',
      status: 'in-progress',
      targetCount,
      roundSize: input.roundSize,
      plannedWordIds,
      completedWordIds: [],
      reviewQueueWordIds: [],
      reviewedWordIds: [],
      currentRoundWordIds,
      currentMissesByWord: {},
      currentMatchedWordIds: [],
      roundNumber: 1,
      durationSeconds: 0,
      totalMistakes: 0,
      startedAt: timestamp,
      completedAt: null,
      updatedAt: timestamp,
    }
    await db.studyTasks.add(created)
    return created
  })
  return { task, words: await getTaskWords(task.currentRoundWordIds) }
}

export async function getResumableStudyTask(libraryId?: string): Promise<StudyTask | undefined> {
  const candidates = libraryId
    ? await db.studyTasks.where('libraryId').equals(libraryId).toArray()
    : await db.studyTasks.orderBy('startedAt').toArray()
  return candidates
    .filter((task) => task.status !== 'completed')
    .sort((left, right) => right.startedAt - left.startedAt)[0]
}

export async function resumeStudyTask(taskId: string): Promise<StudyTaskBundle> {
  const task = await db.transaction('rw', db.studyTasks, async () => {
    const current = await db.studyTasks.get(taskId)
    if (!current || current.status === 'completed') throw new Error('这次学习任务已经结束，请开始一项新任务。')
    const resumed = { ...current, status: 'in-progress' as const, updatedAt: now() }
    await db.studyTasks.put(resumed)
    return resumed
  })
  return { task, words: await getTaskWords(task.currentRoundWordIds) }
}

export async function pauseStudyTask(taskId: string): Promise<void> {
  await db.transaction('rw', db.studyTasks, async () => {
    const task = await db.studyTasks.get(taskId)
    if (task?.status === 'in-progress') await db.studyTasks.update(taskId, { status: 'paused', updatedAt: now() })
  })
}

export async function recordPairResolution(input: {
  taskId: string
  roundNumber: number
  englishWordId: string
  chineseWordId: string
  correct: boolean
}): Promise<StudyTask> {
  return db.transaction('rw', db.studyTasks, async () => {
    const task = await db.studyTasks.get(input.taskId)
    if (!task || task.status !== 'in-progress' || task.roundNumber !== input.roundNumber) throw new Error('当前练习轮次已变化，请重新打开本轮。')
    const currentIds = new Set(task.currentRoundWordIds)
    if (!currentIds.has(input.englishWordId) || !currentIds.has(input.chineseWordId)) throw new Error('这张卡片不属于当前练习轮次。')
    if (input.correct !== (input.englishWordId === input.chineseWordId)) throw new Error('配对结果与词条不一致，未保存。')

    const matched = new Set(task.currentMatchedWordIds)
    const misses = { ...task.currentMissesByWord }
    if (input.correct) {
      matched.add(input.englishWordId)
    } else {
      misses[input.englishWordId] = (misses[input.englishWordId] ?? 0) + 1
      misses[input.chineseWordId] = (misses[input.chineseWordId] ?? 0) + 1
    }
    const next = { ...task, currentMatchedWordIds: [...matched], currentMissesByWord: misses, updatedAt: now() }
    await db.studyTasks.put(next)
    return next
  })
}

export async function completeStudyRound(input: {
  taskId: string
  roundNumber: number
  ratings: Record<string, ReviewRating>
  durationSeconds: number
  timestamp?: number
}): Promise<CompletedRoundResult> {
  const timestamp = input.timestamp ?? now()
  const committed = await db.transaction('rw', db.studyTasks, db.learningProfiles, db.practiceEvents, db.results, async () => {
    const task = await db.studyTasks.get(input.taskId)
    if (!task || task.status !== 'in-progress' || task.roundNumber !== input.roundNumber) throw new Error('这一轮已经保存或发生变化，请返回任务页面。')
    const currentIds = [...new Set(task.currentRoundWordIds)]
    const matched = new Set(task.currentMatchedWordIds)
    if (!currentIds.length || currentIds.some((id) => !matched.has(id))) throw new Error('请先完成本轮所有配对。')
    if (currentIds.some((id) => !input.ratings[id])) throw new Error('请为本轮每个单词选择一次记忆反馈。')

    const id = roundId(task.id, task.roundNumber)
    if (await db.results.get(id)) throw new Error('这一轮已经写入历史记录，避免重复计数。')
    const priorProfiles = await db.learningProfiles.bulkGet(currentIds)
    const profileById = new Map(priorProfiles.filter((profile): profile is WordLearningProfile => Boolean(profile)).map((profile) => [profile.wordId, profile]))
    const events: PracticeEvent[] = []
    const profiles: WordLearningProfile[] = []
    for (const wordId of currentIds) {
      const misses = task.currentMissesByWord[wordId] ?? 0
      const rating = input.ratings[wordId]!
      const previous = profileById.get(wordId) ?? createDefaultLearningProfile({ id: wordId, libraryId: task.libraryId }, timestamp)
      profiles.push(applyPracticeOutcome(previous, { misses, rating }, timestamp))
      events.push({
        id: `${id}:${wordId}`,
        wordId,
        libraryId: task.libraryId,
        taskId: task.id,
        roundId: id,
        roundNumber: task.roundNumber,
        mode: task.practiceMode,
        correct: misses === 0,
        misses,
        rating,
        practicedAt: timestamp,
      })
    }
    await db.learningProfiles.bulkPut(profiles)
    await db.practiceEvents.bulkAdd(events)

    const totalMisses = Object.values(task.currentMissesByWord).reduce((sum, value) => sum + value, 0)
    const result: GameResult = {
      id,
      libraryId: task.libraryId,
      totalPairs: currentIds.length,
      correctPairs: currentIds.filter((wordId) => (task.currentMissesByWord[wordId] ?? 0) === 0).length,
      duration: Math.max(0, Math.floor(input.durationSeconds)),
      completedAt: timestamp,
      mistakes: Math.ceil(totalMisses / 2),
      taskId: task.id,
      roundNumber: task.roundNumber,
      mode: task.practiceMode,
    }
    await db.results.add(result)

    const completedSet = new Set(task.completedWordIds)
    const plannedSet = new Set(task.plannedWordIds)
    for (const wordId of currentIds) if (plannedSet.has(wordId)) completedSet.add(wordId)
    const reviewed = new Set(task.reviewedWordIds)
    const reviewQueue = [...task.reviewQueueWordIds]
    for (const wordId of currentIds) {
      if ((task.currentMissesByWord[wordId] ?? 0) > 0 && !reviewed.has(wordId) && !reviewQueue.includes(wordId)) reviewQueue.push(wordId)
    }

    const queueProfiles = await db.learningProfiles.bulkGet(reviewQueue)
    const profilesForScheduling = new Map<string, WordLearningProfile>()
    for (const profile of queueProfiles) if (profile) profilesForScheduling.set(profile.wordId, profile)
    for (const profile of profiles) profilesForScheduling.set(profile.wordId, profile)
    const next = nextRoundWordIds({
      plannedWordIds: task.plannedWordIds,
      completedWordIds: [...completedSet],
      reviewQueueWordIds: reviewQueue,
      reviewedWordIds: task.reviewedWordIds,
      profiles: [...profilesForScheduling.values()],
      roundSize: task.roundSize,
      now: timestamp,
    })
    const nextRoundNumber = task.roundNumber + (next.wordIds.length ? 1 : 0)
    const isComplete = next.wordIds.length === 0
    const updatedTask: StudyTask = {
      ...task,
      completedWordIds: [...completedSet],
      reviewQueueWordIds: next.remainingReviewQueue,
      reviewedWordIds: next.reviewedWordIds,
      currentRoundWordIds: next.wordIds,
      currentMissesByWord: {},
      currentMatchedWordIds: [],
      roundNumber: nextRoundNumber,
      status: isComplete ? 'completed' : 'in-progress',
      durationSeconds: task.durationSeconds + result.duration,
      totalMistakes: task.totalMistakes + result.mistakes! ,
      completedAt: isComplete ? timestamp : null,
      updatedAt: timestamp,
    }
    await db.studyTasks.put(updatedTask)
    return { task: updatedTask, result }
  })

  return { ...committed, words: await getTaskWords(committed.task.currentRoundWordIds) }
}

export async function getLearningProfiles(libraryId: string): Promise<WordLearningProfile[]> {
  return db.learningProfiles.where('libraryId').equals(libraryId).toArray()
}

export async function getLearningStats(libraryId: string, timestamp = now()): Promise<LearningStats> {
  const [words, profiles] = await Promise.all([
    db.words.where('libraryId').equals(libraryId).filter((word) => word.archivedAt === undefined).toArray(),
    getLearningProfiles(libraryId),
  ])
  const byId = new Map(profiles.map((profile) => [profile.wordId, profile]))
  const stats: LearningStats = { total: words.length, unlearned: 0, learning: 0, fuzzy: 0, familiar: 0, mastered: 0, due: 0, weak: 0 }
  for (const word of words) {
    const profile = byId.get(word.id) ?? createDefaultLearningProfile(word, timestamp)
    stats[profile.status] += 1
    if (profile.nextReviewAt !== null && profile.nextReviewAt <= timestamp) stats.due += 1
    if (profile.incorrectCount > 0 && profile.status !== 'mastered') stats.weak += 1
  }
  return stats
}

export async function setWordLearningStatus(wordId: string, status: WordLearningStatus): Promise<WordLearningProfile> {
  return db.transaction('rw', db.words, db.learningProfiles, async () => {
    const word = await db.words.get(wordId)
    if (!word) throw new Error('找不到这个单词。')
    const profile = await db.learningProfiles.get(wordId) ?? createDefaultLearningProfile(word)
    const updated = setManualLearningStatus(profile, status)
    await db.learningProfiles.put(updated)
    return updated
  })
}

export async function getWordPracticeHistory(wordId: string, limit = 50): Promise<PracticeEvent[]> {
  const events = await db.practiceEvents.where('wordId').equals(wordId).toArray()
  return events.sort((left, right) => right.practicedAt - left.practicedAt).slice(0, limit)
}
