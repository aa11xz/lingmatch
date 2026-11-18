import { db } from '../../db/database'
import { applyPracticeOutcome, createDefaultWordProgress } from './learningEngine'
import { nextRoundWordIds, selectCandidateWordIds } from './schedulingEngine'
import type {
  GameResult,
  LearningStats,
  PairCount,
  PracticeEvent,
  PracticeMode,
  StudyTask,
  StudyTaskMode,
  WordEntry,
  WordProgress,
} from '../../types/domain'

export interface StudyTaskBundle {
  task: StudyTask
  words: WordEntry[]
}

export interface CompletedRoundResult extends StudyTaskBundle {
  result: GameResult
}

export interface LearningDashboard {
  stats: LearningStats
  total: number
  new: number
  learning: number
  weak: number
  familiar: number
  mastered: number
  due: number
  candidateWordCounts: Record<StudyTaskMode, number>
  currentTask?: StudyTask
  resumableTask?: StudyTask
  unfinishedTasks: StudyTask[]
  pausedTasks: StudyTask[]
  recentCompletedTasks: StudyTask[]
}

const now = () => Date.now()
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const roundId = (taskId: string, roundNumber: number) => `${taskId}:round:${roundNumber}`
const activeTask = (task: StudyTask) => task.status === 'in-progress' || task.status === 'paused'

async function getTaskWords(ids: readonly string[]): Promise<WordEntry[]> {
  const uniqueIds = [...new Set(ids)]
  const rows = await db.words.bulkGet(uniqueIds)
  const byId = new Map(rows.filter((word): word is WordEntry => Boolean(word)).map((word) => [word.id, word]))
  return uniqueIds.flatMap((id) => {
    const word = byId.get(id)
    return word ? [word] : []
  })
}

function practicedIds(events: readonly PracticeEvent[]): Set<string> {
  return new Set(events.map((event) => event.wordId))
}

function makeStats(words: readonly WordEntry[], progress: readonly WordProgress[], nowAt: number): LearningStats {
  const byId = new Map(progress.map((item) => [item.wordId, item]))
  const stats: LearningStats = { total: words.length, new: 0, learning: 0, weak: 0, familiar: 0, mastered: 0, due: 0 }
  for (const word of words) {
    const state = byId.get(word.id)?.state ?? 'new'
    stats[state] += 1
    const dueAt = byId.get(word.id)?.nextReviewAt
    if (dueAt !== null && dueAt !== undefined && dueAt <= nowAt) stats.due += 1
  }
  return stats
}

async function readCandidateIds(libraryId: string, mode: StudyTaskMode, timestamp: number): Promise<string[]> {
  const [words, progress, events] = await Promise.all([
    db.words.where('libraryId').equals(libraryId).toArray(),
    db.wordProgress.where('libraryId').equals(libraryId).toArray(),
    mode === 'new' ? db.practiceEvents.where('libraryId').equals(libraryId).toArray() : Promise.resolve([] as PracticeEvent[]),
  ])
  return selectCandidateWordIds({ words, progress, mode, now: timestamp, practicedWordIds: practicedIds(events) })
}

/** Returns the canonical, unique candidate set used by both Dashboard and tasks. */
export async function getCandidateWordIds(libraryId: string, mode: StudyTaskMode, timestamp = now()): Promise<string[]> {
  return db.transaction('r', db.words, db.wordProgress, db.practiceEvents, () => readCandidateIds(libraryId, mode, timestamp))
}

export async function createStudyTask(input: {
  libraryId: string
  mode: StudyTaskMode
  practiceMode?: PracticeMode
  targetCount?: number
  roundSize: PairCount
  timestamp?: number
}): Promise<StudyTaskBundle> {
  const timestamp = input.timestamp ?? now()
  const task = await db.transaction('rw', db.libraries, db.words, db.wordProgress, db.practiceEvents, db.studyTasks, async () => {
    const library = await db.libraries.get(input.libraryId)
    if (!library) throw new Error('找不到这个词库。')
    const [words, progress, events, tasks] = await Promise.all([
      db.words.where('libraryId').equals(input.libraryId).toArray(),
      db.wordProgress.where('libraryId').equals(input.libraryId).toArray(),
      db.practiceEvents.where('libraryId').equals(input.libraryId).toArray(),
      db.studyTasks.where('libraryId').equals(input.libraryId).toArray(),
    ])
    const activeForMode = tasks.filter((candidate) => candidate.mode === input.mode && activeTask(candidate))
      .sort((left, right) => Number(right.status === 'in-progress') - Number(left.status === 'in-progress')
        || right.updatedAt - left.updatedAt || right.startedAt - left.startedAt)
    const existing = activeForMode[0]

    // A mode has one resumable snapshot. If old imported data contains duplicates,
    // retire extras before any new task can be created for that mode.
    for (const duplicate of activeForMode.slice(1)) {
      await db.studyTasks.update(duplicate.id, { status: 'superseded', updatedAt: timestamp })
    }
    if (existing) {
      for (const running of tasks.filter((candidate) => candidate.status === 'in-progress' && candidate.id !== existing.id)) {
        await db.studyTasks.update(running.id, { status: 'paused', updatedAt: timestamp })
      }
      const resumed = { ...existing, status: 'in-progress' as const, updatedAt: timestamp }
      await db.studyTasks.put(resumed)
      return resumed
    }

    const candidateIds = selectCandidateWordIds({
      words,
      progress,
      mode: input.mode,
      now: timestamp,
      practicedWordIds: practicedIds(events),
    })
    const plannedWordIds = input.mode === 'new'
      ? candidateIds.slice(0, Math.max(0, Math.floor(input.targetCount ?? 50)))
      : candidateIds
    if (!plannedWordIds.length) {
      const message = input.mode === 'due' ? '现在没有到期的复习词。'
        : input.mode === 'weak' ? '当前没有需要强化的薄弱词。'
          : input.mode === 'new' ? '这个词库暂时没有未学习的新词。'
            : '这个词库没有可练习的词条。'
      throw new Error(message)
    }

    for (const running of tasks.filter((candidate) => candidate.status === 'in-progress')) {
      await db.studyTasks.update(running.id, { status: 'paused', updatedAt: timestamp })
    }

    const currentRoundWordIds = plannedWordIds.slice(0, input.roundSize)
    const created: StudyTask = {
      id: makeId(),
      libraryId: input.libraryId,
      mode: input.mode,
      practiceMode: input.practiceMode ?? 'match',
      status: 'in-progress',
      roundSize: input.roundSize,
      plannedWordIds,
      completedWordIds: [],
      currentRoundWordIds,
      mistakesByWord: {},
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
  const candidates = await getUnfinishedStudyTasks(libraryId)
  return candidates.find((task) => task.status === 'in-progress') ?? candidates[0]
}

export async function getUnfinishedStudyTasks(libraryId?: string): Promise<StudyTask[]> {
  const candidates = libraryId
    ? await db.studyTasks.where('libraryId').equals(libraryId).toArray()
    : await db.studyTasks.toArray()
  return candidates.filter(activeTask)
    .sort((left, right) => right.updatedAt - left.updatedAt || right.startedAt - left.startedAt)
}

export async function getPausedStudyTasks(libraryId?: string): Promise<StudyTask[]> {
  return (await getUnfinishedStudyTasks(libraryId)).filter((task) => task.status === 'paused')
}

export async function getCurrentStudyTask(libraryId: string): Promise<StudyTask | undefined> {
  return db.studyTasks.where('[libraryId+status]').equals([libraryId, 'in-progress']).first()
}

export async function resumeStudyTask(taskId: string): Promise<StudyTaskBundle> {
  const task = await db.transaction('rw', db.studyTasks, async () => {
    const current = await db.studyTasks.get(taskId)
    if (!current || !activeTask(current)) throw new Error('这次学习任务已经结束，请开始一项新任务。')
    const others = await db.studyTasks.where('[libraryId+status]').equals([current.libraryId, 'in-progress']).toArray()
    const timestamp = now()
    for (const other of others) if (other.id !== taskId) await db.studyTasks.update(other.id, { status: 'paused', updatedAt: timestamp })
    const resumed = { ...current, status: 'in-progress' as const, updatedAt: timestamp }
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
    if (input.correct && matched.has(input.englishWordId)) return task
    if (!input.correct && (matched.has(input.englishWordId) || matched.has(input.chineseWordId))) return task
    const mistakesByWord = { ...task.mistakesByWord }
    if (input.correct) matched.add(input.englishWordId)
    else {
      mistakesByWord[input.englishWordId] = (mistakesByWord[input.englishWordId] ?? 0) + 1
      mistakesByWord[input.chineseWordId] = (mistakesByWord[input.chineseWordId] ?? 0) + 1
    }
    const next = { ...task, currentMatchedWordIds: [...matched], mistakesByWord, updatedAt: now() }
    await db.studyTasks.put(next)
    return next
  })
}

export async function completeStudyRound(input: {
  taskId: string
  roundNumber: number
  durationSeconds: number
  timestamp?: number
}): Promise<CompletedRoundResult> {
  const timestamp = input.timestamp ?? now()
  const committed = await db.transaction('rw', db.studyTasks, db.wordProgress, db.practiceEvents, db.results, async () => {
    const task = await db.studyTasks.get(input.taskId)
    if (!task || task.status !== 'in-progress' || task.roundNumber !== input.roundNumber) throw new Error('这一轮已经保存或发生变化，请返回任务页面。')
    const currentIds = [...new Set(task.currentRoundWordIds)]
    if (!currentIds.length || currentIds.some((id) => !task.plannedWordIds.includes(id))) throw new Error('本轮词条与任务计划不一致。')
    const matched = new Set(task.currentMatchedWordIds)
    if (currentIds.some((id) => !matched.has(id))) throw new Error('请先完成本轮所有配对。')

    const id = roundId(task.id, task.roundNumber)
    if (await db.results.get(id)) throw new Error('这一轮已经写入历史记录，避免重复计数。')
    for (const wordId of currentIds) {
      const existingEvent = await db.practiceEvents.where('[taskId+roundId+wordId]')
        .equals([task.id, id, wordId]).first()
      if (existingEvent) throw new Error('这一轮已经写入练习记录，避免重复计数。')
    }
    const prior = await db.wordProgress.bulkGet(currentIds)
    const progressById = new Map(prior.filter((item): item is WordProgress => Boolean(item)).map((item) => [item.wordId, item]))
    const progress: WordProgress[] = []
    const events: PracticeEvent[] = []
    for (const wordId of currentIds) {
      const mistakes = Math.max(0, Math.floor(task.mistakesByWord[wordId] ?? 0))
      const previous = progressById.get(wordId) ?? createDefaultWordProgress({ id: wordId, libraryId: task.libraryId }, timestamp)
      progress.push(applyPracticeOutcome(previous, { mistakes, firstTryCorrect: mistakes === 0 }, timestamp))
      events.push({
        id: `${id}:${wordId}`,
        wordId,
        libraryId: task.libraryId,
        taskId: task.id,
        roundId: id,
        mode: task.mode,
        mistakes,
        firstTryCorrect: mistakes === 0,
        practicedAt: timestamp,
      })
    }
    await db.wordProgress.bulkPut(progress)
    await db.practiceEvents.bulkAdd(events)

    const totalMistakes = Object.values(task.mistakesByWord).reduce((sum, value) => sum + value, 0)
    const result: GameResult = {
      id,
      libraryId: task.libraryId,
      totalPairs: currentIds.length,
      correctPairs: currentIds.filter((wordId) => (task.mistakesByWord[wordId] ?? 0) === 0).length,
      duration: Math.max(0, Math.floor(input.durationSeconds)),
      completedAt: timestamp,
      mistakes: Math.ceil(totalMistakes / 2),
      taskId: task.id,
      roundNumber: task.roundNumber,
      mode: task.practiceMode,
    }
    await db.results.add(result)

    const completed = new Set(task.completedWordIds)
    const planned = new Set(task.plannedWordIds)
    for (const wordId of currentIds) if (planned.has(wordId)) completed.add(wordId)
    const completedWordIds = [...planned].filter((wordId) => completed.has(wordId))
    const nextWords = nextRoundWordIds({ plannedWordIds: task.plannedWordIds, completedWordIds, roundSize: task.roundSize })
    const isComplete = completedWordIds.length === planned.size
    const updatedTask: StudyTask = {
      ...task,
      completedWordIds,
      currentRoundWordIds: nextWords,
      mistakesByWord: {},
      currentMatchedWordIds: [],
      roundNumber: task.roundNumber + (nextWords.length ? 1 : 0),
      status: isComplete ? 'completed' : 'in-progress',
      durationSeconds: task.durationSeconds + result.duration,
      totalMistakes: task.totalMistakes + (result.mistakes ?? 0),
      completedAt: isComplete ? timestamp : null,
      updatedAt: timestamp,
    }
    await db.studyTasks.put(updatedTask)
    return { task: updatedTask, result }
  })
  return { ...committed, words: await getTaskWords(committed.task.currentRoundWordIds) }
}

export async function getLearningProgress(libraryId: string): Promise<WordProgress[]> {
  return db.wordProgress.where('libraryId').equals(libraryId).toArray()
}

export async function getLearningDashboard(libraryId: string, timestamp = now()): Promise<LearningDashboard> {
  return db.transaction('r', db.words, db.wordProgress, db.practiceEvents, db.studyTasks, async () => {
    const [allWords, progress, events, tasks] = await Promise.all([
      db.words.where('libraryId').equals(libraryId).toArray(),
      db.wordProgress.where('libraryId').equals(libraryId).toArray(),
      db.practiceEvents.where('libraryId').equals(libraryId).toArray(),
      db.studyTasks.where('libraryId').equals(libraryId).toArray(),
    ])
    const words = allWords.filter((word) => word.archivedAt === undefined)
    const practiced = practicedIds(events)
    const candidateWordCounts: Record<StudyTaskMode, number> = {
      due: selectCandidateWordIds({ words, progress, mode: 'due', now: timestamp }).length,
      weak: selectCandidateWordIds({ words, progress, mode: 'weak', now: timestamp }).length,
      new: selectCandidateWordIds({ words, progress, mode: 'new', now: timestamp, practicedWordIds: practiced }).length,
      comprehensive: selectCandidateWordIds({ words, progress, mode: 'comprehensive', now: timestamp }).length,
    }
    const stats = makeStats(words, progress, timestamp)
    stats.new = candidateWordCounts.new
    const sorted = tasks.filter((task) => task.status !== 'superseded')
      .sort((left, right) => right.updatedAt - left.updatedAt || right.startedAt - left.startedAt)
    const unfinishedTasks = sorted.filter(activeTask)
    const pausedTasks = unfinishedTasks.filter((task) => task.status === 'paused')
    const currentTask = unfinishedTasks.find((task) => task.status === 'in-progress')
    return {
      stats,
      ...stats,
      candidateWordCounts,
      currentTask,
      resumableTask: currentTask ?? pausedTasks[0],
      unfinishedTasks,
      pausedTasks,
      recentCompletedTasks: sorted.filter((task) => task.status === 'completed').slice(0, 5),
    }
  })
}

export async function getWordPracticeHistory(wordId: string, limit = 50): Promise<PracticeEvent[]> {
  const events = await db.practiceEvents.where('wordId').equals(wordId).toArray()
  return events.sort((left, right) => right.practicedAt - left.practicedAt).slice(0, limit)
}
