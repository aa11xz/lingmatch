import type { WordEntry } from "../../types/domain";

export type MatchSide = "english" | "chinese";

export interface MatchCardItem {
  wordId: string;
  side: MatchSide;
  label: string;
}

export interface MatchRound {
  words: WordEntry[];
  english: MatchCardItem[];
  chinese: MatchCardItem[];
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index]!;
    result[index] = result[swapIndex]!;
    result[swapIndex] = current;
  }
  return result;
}

/** Selects up to the requested number of words and independently shuffles both columns. */
export function prepareMatchRound(
  entries: readonly WordEntry[],
  requestedPairs: number,
  random: () => number = Math.random,
): MatchRound {
  const words = shuffle(entries, random).slice(0, Math.max(0, requestedPairs));
  const english = words.map((word) => ({ wordId: word.id, side: "english" as const, label: word.english }));
  const chinese = words.map((word) => ({ wordId: word.id, side: "chinese" as const, label: word.chinese }));
  return { words, english: shuffle(english, random), chinese: shuffle(chinese, random) };
}
