import { db } from '../../db/database'
import { DEFAULT_GAME_SETTINGS, type AppTheme, type GameResult, type GameSettings, type WordEntry, type WordLibrary, type WordPairDraft } from '../../types/domain'

const now = () => Date.now()
const makeId = () => crypto.randomUUID()

function cleanDrafts(drafts: WordPairDraft[]): WordPairDraft[] {
  return drafts
    .map(({ english, chinese }) => ({ english: english.trim(), chinese: chinese.trim() }))
    .filter((entry) => entry.english.length > 0 && entry.chinese.length > 0)
}

export async function getLibraries(): Promise<WordLibrary[]> {
  const libraries = await db.libraries.orderBy('updatedAt').reverse().toArray()
  return libraries
}

export async function listWords(libraryId: string): Promise<WordEntry[]> {
  return db.words.where('libraryId').equals(libraryId).sortBy('createdAt')
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

  await db.transaction('rw', db.libraries, db.words, async () => {
    await db.libraries.add(library)
    if (words.length) await db.words.bulkAdd(words)
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
  const words = clean.map((entry, index): WordEntry => ({ ...entry, id: makeId(), libraryId, createdAt: timestamp + index }))
  await db.transaction('rw', db.libraries, db.words, async () => {
    const library = await db.libraries.get(libraryId)
    if (!library) throw new Error('找不到要替换词条的词库。')
    await db.words.where('libraryId').equals(libraryId).delete()
    if (words.length) await db.words.bulkAdd(words)
    await db.libraries.update(libraryId, { wordCount: words.length, updatedAt: timestamp })
  })
}

export async function deleteLibrary(libraryId: string): Promise<void> {
  await db.transaction('rw', db.libraries, db.words, db.results, async () => {
    await db.words.where('libraryId').equals(libraryId).delete()
    await db.results.where('libraryId').equals(libraryId).delete()
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
  const oldResults = await db.results.where('libraryId').equals(result.libraryId).sortBy('completedAt')
  if (oldResults.length > 100) {
    await db.results.bulkDelete(oldResults.slice(0, oldResults.length - 100).map(({ id }) => id))
  }
}

export async function getRecentResults(limit = 20): Promise<GameResult[]> {
  return db.results.orderBy('completedAt').reverse().limit(limit).toArray()
}

export async function refreshLibrary(libraryId: string): Promise<WordLibrary | undefined> {
  const wordCount = await db.words.where('libraryId').equals(libraryId).count()
  await db.libraries.update(libraryId, { wordCount, updatedAt: now() })
  return db.libraries.get(libraryId)
}
