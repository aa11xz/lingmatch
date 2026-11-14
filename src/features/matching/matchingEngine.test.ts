import { describe, expect, it } from "vitest";
import type { WordEntry } from "../../types/domain";
import { prepareMatchRound, shuffle } from "./matchingEngine";

const entries: WordEntry[] = [
  { id: "a", english: "apple", chinese: "苹果", libraryId: "fruit", createdAt: 1 },
  { id: "b", english: "journey", chinese: "旅程", libraryId: "fruit", createdAt: 2 },
  { id: "c", english: "mountain", chinese: "山", libraryId: "fruit", createdAt: 3 },
  { id: "d", english: "bright", chinese: "明亮的", libraryId: "fruit", createdAt: 4 },
];

describe("matchingEngine", () => {
  it("selects no more pairs than the library contains", () => {
    const round = prepareMatchRound(entries.slice(0, 2), 8, () => 0);

    expect(round.words).toHaveLength(2);
    expect(round.english).toHaveLength(2);
    expect(round.chinese).toHaveLength(2);
  });

  it("keeps each English and Chinese card linked by the same word id", () => {
    const round = prepareMatchRound(entries, 4, () => 0);
    const expected = new Map(round.words.map((word) => [word.id, word]));

    expect(round.english.map((card) => card.wordId).sort()).toEqual(round.chinese.map((card) => card.wordId).sort());
    for (const card of round.english) expect(card.label).toBe(expected.get(card.wordId)?.english);
    for (const card of round.chinese) expect(card.label).toBe(expected.get(card.wordId)?.chinese);
  });

  it("shuffles without mutating the source list", () => {
    const source = ["a", "b", "c", "d"];
    const shuffled = shuffle(source, () => 0);

    expect(source).toEqual(["a", "b", "c", "d"]);
    expect(shuffled).toEqual(["b", "c", "d", "a"]);
  });
});
