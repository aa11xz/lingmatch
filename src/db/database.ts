import Dexie, { type EntityTable } from 'dexie'
import type { AppTheme, GameResult, GameSettings, WordEntry, WordLibrary } from '../types/domain'

interface StoredPreference<T> {
  key: string
  value: T
}

class LingMatchDatabase extends Dexie {
  libraries!: EntityTable<WordLibrary, 'id'>
  words!: EntityTable<WordEntry, 'id'>
  settings!: EntityTable<StoredPreference<GameSettings>, 'key'>
  preferences!: EntityTable<StoredPreference<AppTheme>, 'key'>
  results!: EntityTable<GameResult, 'id'>

  constructor() {
    super('LingMatch')
    this.version(1).stores({
      libraries: '&id, name, updatedAt',
      words: '&id, libraryId, english, chinese, createdAt',
      settings: '&key',
      preferences: '&key',
      results: '&id, libraryId, completedAt',
    })
  }
}

export const db = new LingMatchDatabase()
