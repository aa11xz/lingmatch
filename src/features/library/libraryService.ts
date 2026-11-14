import { db } from '../../db/database'
import { DEFAULT_GAME_SETTINGS, type AppTheme, type GameResult, type GameSettings, type WordEntry, type WordLibrary, type WordPairDraft } from '../../types/domain'
import { createDefaultLearningProfile } from '../learning/learningEngine'

const now = () => Date.now()
const makeId = () => crypto.randomUUID()

function cleanDrafts(drafts: WordPairDraft[]): WordPairDraft[] {
  const cleaned = drafts.map(({ english, chinese }) => ({ english: english.trim(), chinese: chinese.trim() }))
  const incomplete = cleaned.findIndex((entry) => !entry.english || !entry.chinese)
  if (incomplete >= 0) throw new Error(`第 ${incomplete + 1} 条词目缺少英文或中文，未保存任何内容。`)
  return cleaned
}

function wordKey(entry: WordPairDraft): string {
  return `${entry.english.normalize('NFC').toLocaleLowerCase()}\u0000${entry.chinese.normalize('NFC')}`
}

export async function getLibraries(): Promise<WordLibrary[]> {
  const libraries = await db.libraries.orderBy('updatedAt').reverse().toArray()
  return Promise.all(libraries.map(async (library) => ({
    ...library,
    wordCount: await db.words.where('libraryId').equals(library.id).filter((word) => word.archivedAt === undefined).count(),
  })))
}

export async function listWords(libraryId: string): Promise<WordEntry[]> {
  return db.words.where('libraryId').equals(libraryId).filter((word) => word.archivedAt === undefined).sortBy('createdAt')
}

export async function createLibrary(name: string, drafts: WordPairDraft[] = []): Promise<WordLibrary> {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('请先填写词库名称。')
  const clean = cleanDrafts(drafts)
  const timestamp = now()
  const library: WordLibrary = {
    id: makeId(),
    name: trimmedName,
    wordCount: clean.length,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const words = clean.map((entry, index): WordEntry => ({ ...entry, id: makeId(), libraryId: library.id, createdAt: timestamp + index }))

  const profiles = words.map((word) => createDefaultLearningProfile(word, timestamp))
  await db.transaction('rw', db.libraries, db.words, db.learningProfiles, async () => {
    await db.libraries.add(library)
    if (words.length) await db.words.bulkAdd(words)
    if (profiles.length) await db.learningProfiles.bulkAdd(profiles)
  })
  return library
}

export async function renameLibrary(libraryId: string, name: string): Promise<void> {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('请先填写词库名称。')
  const updated = await db.libraries.update(libraryId, { name: trimmedName, updatedAt: now() })
  if (!updated) throw new Error('找不到要修改的词库。')
}

export async function replaceLibraryWords(libraryId: string, drafts: WordPairDraft[]): Promise<void> {
  const clean = cleanDrafts(drafts)
  const timestamp = now()
  await db.transaction('rw', db.libraries, db.words, db.learningProfiles, async () => {
    const library = await db.libraries.get(libraryId)
    if (!library) throw new Error('找不到要替换词条的词库。')
    const existing = await db.words.where('libraryId').equals(libraryId).toArray()
    existing.sort((left, right) => Number(left.archivedAt !== undefined) - Number(right.archivedAt !== undefined)
      || left.createdAt - right.createdAt
      || left.id.localeCompare(right.id))
    const byPair = new Map<string, WordEntry[]>()
    for (const word of existing) {
      const key = wordKey(word)
      byPair.set(key, [...(byPair.get(key) ?? []), word])
    }
    const retainedIds = new Set<string>()
    const nextWords: WordEntry[] = []
    for (const [index, entry] of clean.entries()) {
      const matched = byPair.get(wordKey(entry))?.shift()
      const word: WordEntry = matched
        ? { ...matched, english: entry.english, chinese: entry.chinese, archivedAt: undefined }
        : { ...entry, id: makeId(), libraryId, createdAt: timestamp + index }
      retainedIds.add(word.id)
      nextWords.push(word)
      if (!matched) await db.learningProfiles.add(createDefaultLearningProfile(word, timestamp))
    }
    const archivedWords = existing
      .filter((word) => !retainedIds.has(word.id) && word.archivedAt === undefined)
      .map((word) => ({ ...word, archivedAt: timestamp }))
    if (nextWords.length) await db.words.bulkPut(nextWords)
    if (archivedWords.length) await db.words.bulkPut(archivedWords)
    await db.libraries.update(libraryId, { wordCount: clean.length, updatedAt: timestamp })
  })
}

export async function deleteLibrary(libraryId: string): Promise<void> {
  await db.transaction('rw', [db.libraries, db.words, db.results, db.learningProfiles, db.practiceEvents, db.studyTasks], async () => {
    await db.words.where('libraryId').equals(libraryId).delete()
    await db.results.where('libraryId').equals(libraryId).delete()
    await db.learningProfiles.where('libraryId').equals(libraryId).delete()
    await db.practiceEvents.where('libraryId').equals(libraryId).delete()
    await db.studyTasks.where('libraryId').equals(libraryId).delete()
    await db.libraries.delete(libraryId)
  })
}

export async function loadSettings(): Promise<GameSettings> {
  const saved = await db.settings.get('game')
  return saved?.value ?? DEFAULT_GAME_SETTINGS
}

export async function saveSettings(settings: GameSettings): Promise<void> {
  await db.settings.put({ key: 'game', value: settings })
}

export async function loadTheme(): Promise<AppTheme> {
  return (await db.preferences.get('theme'))?.value ?? 'light'
}

export async function saveTheme(theme: AppTheme): Promise<void> {
  await db.preferences.put({ key: 'theme', value: theme })
}

export async function saveGameResult(result: GameResult): Promise<void> {
  await db.results.put(result)
}

export async function getRecentResults(limit = 20): Promise<GameResult[]> {
  return db.results.orderBy('completedAt').reverse().limit(limit).toArray()
}

export async function refreshLibrary(libraryId: string): Promise<WordLibrary | undefined> {
  const wordCount = await db.words.where('libraryId').equals(libraryId).filter((word) => word.archivedAt === undefined).count()
  await db.libraries.update(libraryId, { wordCount, updatedAt: now() })
  return db.libraries.get(libraryId)
}
