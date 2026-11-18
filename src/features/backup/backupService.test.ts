import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { LingMatchDatabase } from '../../db/database'
import { DEFAULT_GAME_SETTINGS } from '../../types/domain'
import { exportLingMatchBackup, parseLingMatchBackup, restoreLingMatchBackup } from './backupService'

function createName(label: string) {
  return `LingMatch-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function seed(database: LingMatchDatabase) {
  await database.open()
  const library = { id: 'library-backup', name: '备份词库', wordCount: 50, createdAt: 10, updatedAt: 60 }
  const words = Array.from({ length: 50 }, (_, index) => ({
    id: `backup-word-${String(index + 1).padStart(2, '0')}`,
    libraryId: library.id,
    english: `word${index + 1}`,
    chinese: `释义${index + 1}`,
    createdAt: index + 1,
  }))
  const wordProgress = words.map((word, index) => ({
    wordId: word.id,
    libraryId: library.id,
    state: index < 30 ? 'familiar' as const : 'learning' as const,
    correctSessions: index < 30 ? 4 : 1,
    wrongSessions: index === 44 ? 2 : 0,
    consecutiveCorrect: index < 30 ? 3 : 1,
    lastPracticedAt: 20_000 + index,
    lastWrongAt: index === 44 ? 19_999 : null,
    nextReviewAt: 30_000 + index,
    updatedAt: 30_001 + index,
  }))
  const result = {
    id: 'backup-result', libraryId: library.id, totalPairs: 10, correctPairs: 8,
    duration: 90, completedAt: 25_000, mistakes: 2, taskId: 'backup-task', roundNumber: 4, mode: 'match' as const,
  }
  const event = {
    id: 'backup-event', wordId: words[0]!.id, libraryId: library.id, taskId: 'backup-task',
    roundId: 'backup-task:round:5', mode: 'comprehensive' as const,
    mistakes: 0, firstTryCorrect: true, practicedAt: 26_000,
  }
  const task = {
    id: 'backup-task', libraryId: library.id, mode: 'comprehensive' as const, practiceMode: 'match' as const,
    status: 'in-progress' as const, roundSize: 10 as const,
    plannedWordIds: words.map((word) => word.id), completedWordIds: words.slice(0, 40).map((word) => word.id),
    currentRoundWordIds: words.slice(40).map((word) => word.id),
    mistakesByWord: { [words[40]!.id]: 1, [words[44]!.id]: 2 },
    currentMatchedWordIds: words.slice(40, 43).map((word) => word.id),
    roundNumber: 5, durationSeconds: 425, totalMistakes: 7, startedAt: 10_000, completedAt: null, updatedAt: 26_001,
  }
  const settings = { key: 'game', value: { ...DEFAULT_GAME_SETTINGS, pairsPerRound: 10 as const } }
  const preferences = { key: 'theme', value: 'dark' as const }
  await database.libraries.add(library)
  await database.words.bulkAdd(words)
  await database.wordProgress.bulkAdd(wordProgress)
  await database.results.add(result)
  await database.practiceEvents.add(event)
  await database.studyTasks.add(task)
  await database.settings.add(settings)
  await database.preferences.add(preferences)
  return { library, words, wordProgress, result, event, task, settings, preferences }
}

describe('LingMatch JSON backup v2', () => {
  it('exports and restores every store, including WordProgress and an unfinished task snapshot', async () => {
    const source = new LingMatchDatabase(createName('backup-source'))
    const target = new LingMatchDatabase(createName('backup-target'))
    try {
      const expected = await seed(source)
      const backup = await exportLingMatchBackup(source)
      expect(backup.version).toBe(2)
      const parsed = parseLingMatchBackup(JSON.parse(JSON.stringify(backup)))
      const summary = await restoreLingMatchBackup(parsed, { strategy: 'merge', database: target })

      expect(summary.libraries).toEqual({ added: 1, kept: 0, removed: 0 })
      expect(summary.words).toEqual({ added: 50, kept: 0, removed: 0 })
      expect(summary.studyTasks).toEqual({ added: 1, kept: 0, removed: 0 })
      expect(await target.libraries.toArray()).toEqual([expected.library])
      expect(await target.words.toArray()).toEqual(expected.words)
      expect(await target.wordProgress.toArray()).toEqual(expected.wordProgress)
      expect(await target.results.toArray()).toEqual([expected.result])
      expect(await target.practiceEvents.toArray()).toEqual([expected.event])
      expect(await target.studyTasks.toArray()).toEqual([expected.task])
      expect(await target.settings.toArray()).toEqual([expected.settings])
      expect(await target.preferences.toArray()).toEqual([expected.preferences])
    } finally {
      source.close(); target.close()
      await new Dexie(source.name).delete()
      await new Dexie(target.name).delete()
    }
  })

  it('keeps existing records on merge conflicts and rejects malformed backups before writing', async () => {
    const source = new LingMatchDatabase(createName('backup-old'))
    const target = new LingMatchDatabase(createName('backup-current'))
    try {
      const fixture = await seed(source)
      const backup = await exportLingMatchBackup(source)
      await seed(target)
      const newerTask = { ...fixture.task, completedWordIds: fixture.words.slice(0, 41).map((word) => word.id), updatedAt: 99_999 }
      await target.studyTasks.put(newerTask)

      const summary = await restoreLingMatchBackup(backup, { strategy: 'merge', database: target })
      expect(summary.studyTasks).toEqual({ added: 0, kept: 1, removed: 0 })
      expect(await target.studyTasks.get(newerTask.id)).toEqual(newerTask)

      const beforeWordCount = await target.words.count()
      const malformed = structuredClone(backup) as unknown as { data: { words: Array<Record<string, unknown>> } }
      malformed.data.words[0] = { id: 'broken', libraryId: fixture.library.id, english: 'missing Chinese', createdAt: 1 }
      await expect(restoreLingMatchBackup(malformed, { strategy: 'merge', database: target })).rejects.toThrow('备份文件无效')
      expect(await target.words.count()).toBe(beforeWordCount)
      expect(await target.studyTasks.get(newerTask.id)).toEqual(newerTask)
    } finally {
      source.close(); target.close()
      await new Dexie(source.name).delete()
      await new Dexie(target.name).delete()
    }
  })

  it('retires an imported active task when the same library and mode already has a local active task', async () => {
    const source = new LingMatchDatabase(createName('active-task-source'))
    const target = new LingMatchDatabase(createName('active-task-target'))
    try {
      const incoming = await seed(source)
      const local = await seed(target)
      await target.practiceEvents.clear()
      await target.results.clear()
      await target.studyTasks.clear()
      const localTask = { ...local.task, id: 'local-active-task', startedAt: 80_000, updatedAt: 80_000 }
      await target.studyTasks.add(localTask)

      const summary = await restoreLingMatchBackup(await exportLingMatchBackup(source), { strategy: 'merge', database: target })

      expect(summary.studyTasks).toEqual({ added: 1, kept: 0, removed: 0 })
      expect(await target.studyTasks.get(localTask.id)).toMatchObject({ status: 'in-progress' })
      expect(await target.studyTasks.get(incoming.task.id)).toMatchObject({ status: 'superseded' })
      expect((await target.studyTasks.where('status').equals('in-progress').toArray()).map((task) => task.id)).toEqual([localTask.id])
    } finally {
      source.close(); target.close()
      await new Dexie(source.name).delete()
      await new Dexie(target.name).delete()
    }
  })

  it('deduplicates merged practice events by task, round, and word even when their IDs differ', async () => {
    const source = new LingMatchDatabase(createName('event-merge-source'))
    const target = new LingMatchDatabase(createName('event-merge-target'))
    try {
      await seed(source)
      const local = await seed(target)
      await target.practiceEvents.clear()
      await target.practiceEvents.add({ ...local.event, id: 'local-semantic-event' })

      const summary = await restoreLingMatchBackup(await exportLingMatchBackup(source), { strategy: 'merge', database: target })

      expect(summary.practiceEvents).toEqual({ added: 0, kept: 1, removed: 0 })
      expect(await target.practiceEvents.count()).toBe(1)
      expect(await target.practiceEvents.get('local-semantic-event')).toEqual({ ...local.event, id: 'local-semantic-event' })
      expect(await target.practiceEvents.get(local.event.id)).toBeUndefined()
    } finally {
      source.close(); target.close()
      await new Dexie(source.name).delete()
      await new Dexie(target.name).delete()
    }
  })

  it('replaces each data store so the chosen snapshot restores the exact task progress', async () => {
    const source = new LingMatchDatabase(createName('replace-backup'))
    const target = new LingMatchDatabase(createName('replace-current'))
    try {
      const fixture = await seed(source)
      const backup = await exportLingMatchBackup(source)
      await seed(target)
      await target.studyTasks.put({
        ...fixture.task,
        completedWordIds: fixture.words.slice(0, 41).map((word) => word.id),
        updatedAt: 99_999,
      })
      const extraLibrary = { id: 'local-only-library', name: '本机额外词库', wordCount: 0, createdAt: 1, updatedAt: 1 }
      await target.libraries.add(extraLibrary)

      const summary = await restoreLingMatchBackup(backup, { strategy: 'replace', database: target })
      expect(await target.studyTasks.get(fixture.task.id)).toEqual(fixture.task)
      expect((await target.studyTasks.get(fixture.task.id))?.completedWordIds).toHaveLength(40)
      expect(await target.libraries.get(extraLibrary.id)).toBeUndefined()
      expect((await exportLingMatchBackup(target)).data).toEqual(backup.data)
      expect(summary.libraries).toEqual({ added: 1, kept: 0, removed: 2 })
      expect(summary.studyTasks).toEqual({ added: 1, kept: 0, removed: 1 })
      expect(summary.wordProgress).toEqual({ added: 50, kept: 0, removed: 50 })
    } finally {
      source.close(); target.close()
      await new Dexie(source.name).delete()
      await new Dexie(target.name).delete()
    }
  })

  it('rolls back the whole replace transaction if any store write fails', async () => {
    const source = new LingMatchDatabase(createName('replace-failure-source'))
    const target = new LingMatchDatabase(createName('replace-failure-target'))
    try {
      await seed(source)
      const backup = await exportLingMatchBackup(source)
      await seed(target)
      const before = (await exportLingMatchBackup(target)).data
      target.practiceEvents.hook('creating', () => {
        throw new Error('simulated write failure')
      })

      await expect(restoreLingMatchBackup(backup, { strategy: 'replace', database: target })).rejects.toThrow('simulated write failure')
      expect((await exportLingMatchBackup(target)).data).toEqual(before)
    } finally {
      source.close(); target.close()
      await new Dexie(source.name).delete()
      await new Dexie(target.name).delete()
    }
  })

  it('rejects invalid progress, task plans, references, and duplicate unfinished mode tasks', async () => {
    const source = new LingMatchDatabase(createName('validation-source'))
    try {
      await seed(source)
      const backup = await exportLingMatchBackup(source)
      const cases: Array<[string, (data: any) => void]> = [
        ['negative wrong session count', (data) => { data.wordProgress[0].wrongSessions = -1 }],
        ['fractional task counter', (data) => { data.studyTasks[0].totalMistakes = 1.5 }],
        ['result correct count above total', (data) => { data.results[0].correctPairs = data.results[0].totalPairs + 1 }],
        ['duplicate task primary ID', (data) => { data.studyTasks.push({ ...data.studyTasks[0] }) }],
        ['duplicate planned ID', (data) => { data.studyTasks[0].plannedWordIds[1] = data.studyTasks[0].plannedWordIds[0] }],
        ['completed ID outside plan', (data) => { data.studyTasks[0].completedWordIds[0] = 'missing-word' }],
        ['matched ID outside current round', (data) => { data.studyTasks[0].currentMatchedWordIds[0] = data.studyTasks[0].plannedWordIds[0] }],
        ['miss ID outside current round', (data) => { data.studyTasks[0].mistakesByWord['backup-word-01'] = 1 }],
        ['duplicate active task for the same mode', (data) => { data.studyTasks.push({ ...data.studyTasks[0], id: 'duplicate-task' }) }],
        ['event mode differs from task mode', (data) => { data.practiceEvents[0].mode = 'weak' }],
        ['duplicate semantic practice event', (data) => { data.practiceEvents.push({ ...data.practiceEvents[0], id: 'duplicate-event-id' }) }],
        ['word is missing its progress row', (data) => { data.wordProgress.pop() }],
      ]

      for (const [label, mutate] of cases) {
        const malformed = structuredClone(backup) as any
        mutate(malformed.data)
        expect(() => parseLingMatchBackup(malformed), label).toThrow('备份文件无效')
      }
    } finally {
      source.close()
      await new Dexie(source.name).delete()
    }
  })
})
