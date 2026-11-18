import type { Transaction } from 'dexie'
import { db, type LingMatchDatabase } from '../../db/database'
import type {
  AppTheme,
  GameResult,
  GameSettings,
  PracticeEvent,
  PracticeMode,
  StudyTask,
  StudyTaskMode,
  StudyTaskStatus,
  WordEntry,
  WordLibrary,
  WordProgress,
  WordProgressState,
} from '../../types/domain'

type StoredValue<T> = { key: string; value: T }

export interface LingMatchBackup {
  format: 'lingmatch-backup'
  version: 2
  databaseName: 'LingMatch'
  exportedAt: string
  data: {
    libraries: WordLibrary[]
    words: WordEntry[]
    settings: StoredValue<GameSettings>[]
    preferences: StoredValue<AppTheme>[]
    results: GameResult[]
    wordProgress: WordProgress[]
    practiceEvents: PracticeEvent[]
    studyTasks: StudyTask[]
  }
}

export type BackupStoreName = keyof LingMatchBackup['data']
export type RestoreStrategy = 'merge' | 'replace'
export type RestoreSummary = Record<BackupStoreName, { added: number; kept: number; removed: number }>

const STORE_NAMES: BackupStoreName[] = [
  'libraries', 'words', 'settings', 'preferences', 'results', 'wordProgress', 'practiceEvents', 'studyTasks',
]
const PROGRESS_STATES: WordProgressState[] = ['new', 'learning', 'weak', 'familiar', 'mastered']
const PRACTICE_MODES: PracticeMode[] = ['match', 'flashcard', 'multipleChoice', 'spelling', 'listening']
const TASK_MODES: StudyTaskMode[] = ['due', 'weak', 'new', 'comprehensive']
const TASK_STATUSES: StudyTaskStatus[] = ['in-progress', 'completed', 'paused', 'superseded']
const PAIR_COUNTS = [4, 6, 8, 10, 12]

function fail(message: string): never {
  throw new Error(`备份文件无效：${message}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value)
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isString(item) && item.length > 0)
}

function hasEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function isSettings(value: unknown): value is GameSettings {
  return isObject(value)
    && PAIR_COUNTS.includes(value.pairsPerRound as number)
    && typeof value.timerEnabled === 'boolean'
    && typeof value.soundEnabled === 'boolean'
    && typeof value.vibrationEnabled === 'boolean'
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  return isObject(value) && Object.entries(value).every(([key, item]) => key.length > 0 && isNonNegativeInteger(item))
}

function isLibrary(value: unknown): value is WordLibrary {
  return isObject(value)
    && isString(value.id) && value.id.length > 0
    && isString(value.name) && value.name.trim().length > 0
    && isNonNegativeInteger(value.wordCount)
    && isNonNegativeInteger(value.createdAt) && isNonNegativeInteger(value.updatedAt)
}

function isWord(value: unknown): value is WordEntry {
  return isObject(value)
    && isString(value.id) && value.id.length > 0
    && isString(value.libraryId) && value.libraryId.length > 0
    && isString(value.english) && isString(value.chinese)
    && isNonNegativeInteger(value.createdAt)
    && (value.archivedAt === undefined || isNonNegativeInteger(value.archivedAt))
}

function isStoredSetting(value: unknown): value is StoredValue<GameSettings> {
  return isObject(value) && isString(value.key) && value.key.length > 0 && isSettings(value.value)
}

function isStoredPreference(value: unknown): value is StoredValue<AppTheme> {
  return isObject(value) && isString(value.key) && value.key.length > 0 && (value.value === 'light' || value.value === 'dark')
}

function isGameResult(value: unknown): value is GameResult {
  return isObject(value)
    && isString(value.id) && value.id.length > 0
    && isString(value.libraryId) && value.libraryId.length > 0
    && isNonNegativeInteger(value.totalPairs) && isNonNegativeInteger(value.correctPairs)
    && value.correctPairs <= value.totalPairs
    && isNonNegativeInteger(value.duration) && isNonNegativeInteger(value.completedAt)
    && (value.mistakes === undefined || isNonNegativeInteger(value.mistakes))
    && (value.taskId === undefined || (isString(value.taskId) && value.taskId.length > 0))
    && (value.roundNumber === undefined || isNonNegativeInteger(value.roundNumber))
    && (value.mode === undefined || hasEnum(value.mode, PRACTICE_MODES))
}

function isWordProgress(value: unknown): value is WordProgress {
  return isObject(value)
    && isString(value.wordId) && value.wordId.length > 0
    && isString(value.libraryId) && value.libraryId.length > 0
    && hasEnum(value.state, PROGRESS_STATES)
    && isNonNegativeInteger(value.correctSessions) && isNonNegativeInteger(value.wrongSessions)
    && isNonNegativeInteger(value.consecutiveCorrect)
    && isNullableTimestamp(value.lastPracticedAt) && isNullableTimestamp(value.lastWrongAt)
    && isNullableTimestamp(value.nextReviewAt) && isNonNegativeInteger(value.updatedAt)
}

function isPracticeEvent(value: unknown): value is PracticeEvent {
  return isObject(value)
    && isString(value.id) && value.id.length > 0
    && isString(value.wordId) && value.wordId.length > 0
    && isString(value.libraryId) && value.libraryId.length > 0
    && isString(value.taskId) && value.taskId.length > 0
    && isString(value.roundId) && value.roundId.length > 0
    && hasEnum(value.mode, TASK_MODES)
    && isNonNegativeInteger(value.mistakes)
    && typeof value.firstTryCorrect === 'boolean'
    && value.firstTryCorrect === (value.mistakes === 0)
    && isNonNegativeInteger(value.practicedAt)
}

function isStudyTask(value: unknown): value is StudyTask {
  return isObject(value)
    && isString(value.id) && value.id.length > 0
    && isString(value.libraryId) && value.libraryId.length > 0
    && hasEnum(value.mode, TASK_MODES) && hasEnum(value.practiceMode, PRACTICE_MODES)
    && hasEnum(value.status, TASK_STATUSES)
    && PAIR_COUNTS.includes(value.roundSize as number)
    && isStringArray(value.plannedWordIds) && isStringArray(value.completedWordIds)
    && isStringArray(value.currentRoundWordIds) && isStringArray(value.currentMatchedWordIds)
    && isRecordOfNumbers(value.mistakesByWord)
    && isNonNegativeInteger(value.roundNumber)
    && isNonNegativeInteger(value.durationSeconds) && isNonNegativeInteger(value.totalMistakes)
    && isNonNegativeInteger(value.startedAt) && isNullableTimestamp(value.completedAt)
    && isNonNegativeInteger(value.updatedAt)
}

function hasUniqueIds(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function hasUniqueKeys<T>(rows: readonly T[], keyOf: (row: T) => string, label: string): void {
  const keys = rows.map(keyOf)
  if (new Set(keys).size !== keys.length) fail(`${label} 含有重复标识`)
}

function validateReferences(data: LingMatchBackup['data']): void {
  const libraryIds = new Set(data.libraries.map((row) => row.id))
  const wordsById = new Map(data.words.map((row) => [row.id, row]))
  const tasksById = new Map(data.studyTasks.map((row) => [row.id, row]))
  const progressWordIds = new Set(data.wordProgress.map((row) => row.wordId))
  const practiceEventKeys = new Set<string>()
  const activeModes = new Set<string>()

  for (const word of data.words) {
    if (!libraryIds.has(word.libraryId)) fail(`词条「${word.english}」引用了不存在的词库`)
  }
  for (const progress of data.wordProgress) {
    const word = wordsById.get(progress.wordId)
    if (!word || word.libraryId !== progress.libraryId) fail(`单词「${progress.wordId}」的学习进度无法对应词库`)
  }
  for (const word of data.words) {
    if (!progressWordIds.has(word.id)) fail(`词条「${word.english}」缺少唯一学习进度`)
  }
  for (const event of data.practiceEvents) {
    const word = wordsById.get(event.wordId)
    const task = tasksById.get(event.taskId)
    if (!word || word.libraryId !== event.libraryId) fail(`练习记录「${event.id}」引用了不存在的单词`)
    if (!task || task.libraryId !== event.libraryId || task.mode !== event.mode) fail(`练习记录「${event.id}」引用了不存在或不一致的任务`)
    const semanticKey = `${event.taskId}\u0000${event.roundId}\u0000${event.wordId}`
    if (practiceEventKeys.has(semanticKey)) fail(`练习记录「${event.id}」重复记录了同一任务轮次的单词`)
    practiceEventKeys.add(semanticKey)
  }
  for (const result of data.results) {
    if (!libraryIds.has(result.libraryId)) fail(`练习结果「${result.id}」引用了不存在的词库`)
    if (result.taskId && !tasksById.has(result.taskId)) fail(`练习结果「${result.id}」引用了不存在的学习任务`)
  }
  for (const task of data.studyTasks) {
    if (!libraryIds.has(task.libraryId)) fail(`学习任务「${task.id}」引用了不存在的词库`)
    const referencedIds = [
      ...task.plannedWordIds, ...task.completedWordIds,
      ...task.currentRoundWordIds, ...task.currentMatchedWordIds,
      ...Object.keys(task.mistakesByWord),
    ]
    if (referencedIds.some((id) => wordsById.get(id)?.libraryId !== task.libraryId)) fail(`学习任务「${task.id}」含有不属于该词库的单词`)
    if (!hasUniqueIds(task.plannedWordIds) || !hasUniqueIds(task.completedWordIds)
      || !hasUniqueIds(task.currentRoundWordIds) || !hasUniqueIds(task.currentMatchedWordIds)) {
      fail(`学习任务「${task.id}」含有重复单词标识`)
    }
    const planned = new Set(task.plannedWordIds)
    const currentRound = new Set(task.currentRoundWordIds)
    if (task.completedWordIds.some((id) => !planned.has(id))) fail(`学习任务「${task.id}」的完成记录超出计划范围`)
    if (task.currentRoundWordIds.some((id) => !planned.has(id))) fail(`学习任务「${task.id}」的当前轮超出计划范围`)
    if (task.currentMatchedWordIds.some((id) => !currentRound.has(id))) fail(`学习任务「${task.id}」的已配对记录与当前轮不一致`)
    if (Object.keys(task.mistakesByWord).some((id) => !currentRound.has(id))) fail(`学习任务「${task.id}」的错配记录与当前轮不一致`)
    if (task.status === 'completed' && (task.completedAt === null || task.completedWordIds.length !== task.plannedWordIds.length)) {
      fail(`已完成任务「${task.id}」的完成状态与进度不一致`)
    }
    if ((task.status === 'in-progress' || task.status === 'paused') && task.completedAt !== null) fail(`未完成任务「${task.id}」带有完成时间`)
    if (task.status === 'in-progress' || task.status === 'paused') {
      const key = `${task.libraryId}:${task.mode}`
      if (activeModes.has(key)) fail(`词库「${task.libraryId}」存在重复的未完成「${task.mode}」任务`)
      activeModes.add(key)
    }
  }
}

export function parseLingMatchBackup(value: unknown): LingMatchBackup {
  if (!isObject(value) || value.format !== 'lingmatch-backup' || value.version !== 2 || value.databaseName !== 'LingMatch') {
    fail('版本或数据库标识不支持')
  }
  if (!isString(value.exportedAt) || Number.isNaN(Date.parse(value.exportedAt)) || !isObject(value.data)) fail('缺少备份时间或数据区')

  const data = value.data
  const checks: [BackupStoreName, (item: unknown) => boolean][] = [
    ['libraries', isLibrary], ['words', isWord], ['settings', isStoredSetting], ['preferences', isStoredPreference],
    ['results', isGameResult], ['wordProgress', isWordProgress], ['practiceEvents', isPracticeEvent], ['studyTasks', isStudyTask],
  ]
  for (const [name, check] of checks) {
    if (!Array.isArray(data[name]) || !data[name].every(check)) fail(`${name} 数据格式不正确`)
  }

  const backup = value as unknown as LingMatchBackup
  hasUniqueKeys(backup.data.libraries, (row) => row.id, '词库')
  hasUniqueKeys(backup.data.words, (row) => row.id, '词条')
  hasUniqueKeys(backup.data.settings, (row) => row.key, '设置')
  hasUniqueKeys(backup.data.preferences, (row) => row.key, '偏好设置')
  hasUniqueKeys(backup.data.results, (row) => row.id, '练习结果')
  hasUniqueKeys(backup.data.wordProgress, (row) => row.wordId, '学习进度')
  hasUniqueKeys(backup.data.practiceEvents, (row) => row.id, '练习记录')
  hasUniqueKeys(backup.data.studyTasks, (row) => row.id, '学习任务')
  validateReferences(backup.data)
  return backup
}

function emptySummary(): RestoreSummary {
  return Object.fromEntries(STORE_NAMES.map((name) => [name, { added: 0, kept: 0, removed: 0 }])) as RestoreSummary
}

function storeKey(storeName: BackupStoreName, row: Record<string, unknown>): string {
  const key = storeName === 'settings' || storeName === 'preferences'
    ? row.key
    : storeName === 'wordProgress' ? row.wordId : row.id
  return String(key)
}

export async function exportLingMatchBackup(database: LingMatchDatabase = db): Promise<LingMatchBackup> {
  const tables = [
    database.libraries, database.words, database.settings, database.preferences,
    database.results, database.wordProgress, database.practiceEvents, database.studyTasks,
  ]
  return database.transaction('r', tables, async () => {
    const [libraries, words, settings, preferences, results, wordProgress, practiceEvents, studyTasks] = await Promise.all([
      database.libraries.toArray(), database.words.toArray(), database.settings.toArray(), database.preferences.toArray(),
      database.results.toArray(), database.wordProgress.toArray(), database.practiceEvents.toArray(), database.studyTasks.toArray(),
    ])
    return {
      format: 'lingmatch-backup',
      version: 2,
      databaseName: 'LingMatch',
      exportedAt: new Date().toISOString(),
      data: { libraries, words, settings, preferences, results, wordProgress, practiceEvents, studyTasks },
    }
  })
}

export async function restoreLingMatchBackup(
  value: unknown,
  options: { strategy: RestoreStrategy; database?: LingMatchDatabase },
): Promise<RestoreSummary> {
  const backup = parseLingMatchBackup(value)
  if (options.strategy !== 'merge' && options.strategy !== 'replace') fail('恢复方式不支持')
  const database = options.database ?? db
  const strategy = options.strategy
  const summary = emptySummary()
  const tables = [
    database.libraries, database.words, database.settings, database.preferences,
    database.results, database.wordProgress, database.practiceEvents, database.studyTasks,
  ]

  await database.transaction('rw', tables, async (transaction: Transaction) => {
    const [currentLibraries, currentWords, currentSettings, currentPreferences, currentResults, currentProgress, currentEvents, currentTasks] = await Promise.all([
      database.libraries.toArray(), database.words.toArray(), database.settings.toArray(), database.preferences.toArray(),
      database.results.toArray(), database.wordProgress.toArray(), database.practiceEvents.toArray(), database.studyTasks.toArray(),
    ])
    const currentByStore = [currentLibraries, currentWords, currentSettings, currentPreferences, currentResults, currentProgress, currentEvents, currentTasks] as const

    if (strategy === 'replace') {
      for (let index = 0; index < STORE_NAMES.length; index += 1) {
        const storeName = STORE_NAMES[index]!
        summary[storeName].removed = (currentByStore[index] as readonly unknown[]).length
        await transaction.table(storeName).clear()
      }
      for (const storeName of STORE_NAMES) {
        const incomingRows = backup.data[storeName] as unknown as Array<Record<string, unknown>>
        summary[storeName].added = incomingRows.length
        if (incomingRows.length) await transaction.table(storeName).bulkAdd(incomingRows)
      }
      return
    }

    for (const [index, storeName] of STORE_NAMES.entries()) {
      const currentRows = currentByStore[index] as unknown as Array<Record<string, unknown>>
      const currentKeys = new Set(currentRows.map((row) => storeKey(storeName, row)))
      const incomingRows = backup.data[storeName] as unknown as Array<Record<string, unknown>>
      const eventKeys = storeName === 'practiceEvents'
        ? new Set(currentRows.map((row) => `${row.taskId}\u0000${row.roundId}\u0000${row.wordId}`))
        : undefined
      const activeModes = storeName === 'studyTasks'
        ? new Set(currentRows
          .filter((row) => row.status === 'in-progress' || row.status === 'paused')
          .map((row) => `${row.libraryId}:${row.mode}`))
        : undefined
      const additions: Array<Record<string, unknown>> = []
      for (const row of incomingRows) {
        const key = storeKey(storeName, row)
        if (currentKeys.has(key)) {
          summary[storeName].kept += 1
          continue
        }
        if (eventKeys) {
          const semanticKey = `${row.taskId}\u0000${row.roundId}\u0000${row.wordId}`
          if (eventKeys.has(semanticKey)) {
            summary[storeName].kept += 1
            continue
          }
          eventKeys.add(semanticKey)
        }
        let addition = row
        if (activeModes && (row.status === 'in-progress' || row.status === 'paused')) {
          const activeModeKey = `${row.libraryId}:${row.mode}`
          if (activeModes.has(activeModeKey)) {
            // Keep the local active snapshot authoritative while preserving the
            // imported task and its history as a retired task record.
            addition = { ...row, status: 'superseded' }
          } else {
            activeModes.add(activeModeKey)
          }
        }
        currentKeys.add(key)
        summary[storeName].added += 1
        additions.push(addition)
      }
      if (additions.length) await transaction.table(storeName).bulkAdd(additions)
    }
  })
  return summary
}
