import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { findDuplicateIndexes, parseImportFile } from './importManager'

const makeFile = (name: string, content: string | Uint8Array) => {
  const part: BlobPart = typeof content === 'string' ? content : new Uint8Array(content).buffer
  return new File([part], name)
}

function makeTextPdf(lines: string[]) {
  const encodedChinese: Record<string, string> = { 苹果: '00010002', 书: '0003' }
  const stream = ['BT', '/F1 14 Tf', '72 220 Td', ...lines.flatMap((line, index) => [
    index ? '0 -24 Td' : '',
    encodedChinese[line] ? `<${encodedChinese[line]}> Tj` : `(${line.replace(/[()\\]/g, '\\$&')}) Tj`,
  ]).filter(Boolean), 'ET'].join('\n')
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    '3 beginbfchar',
    '<0001> <82F9>',
    '<0002> <679C>',
    '<0003> <4E66>',
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>',
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`,
    `<< /Length ${new TextEncoder().encode(cmap).length} >>\nstream\n${cmap}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(pdf).length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = new TextEncoder().encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return makeFile('words.pdf', new TextEncoder().encode(pdf))
}

describe('local import parsing', () => {
  it('reads UTF-8 BOM CSV, quoted commas, and a header without shifting translations', async () => {
    const file = makeFile('words.csv', '\uFEFFEnglish,Chinese\r\nApple,"水果, 苹果"\r\nBook,书')
    const result = await parseImportFile(file)
    expect(result.words).toEqual([
      { english: 'Apple', chinese: '水果, 苹果' },
      { english: 'Book', chinese: '书' },
    ])
  })

  it('reads CSV rows without a header and can remap columns manually', async () => {
    const file = makeFile('words.csv', 'Unit 1,苹果,Apple\nUnit 2,书,Book')
    const result = await parseImportFile(file, { hasHeader: false, englishColumn: 2, chineseColumn: 1 })
    expect(result.words).toEqual([
      { english: 'Apple', chinese: '苹果' },
      { english: 'Book', chinese: '书' },
    ])
  })

  it('recognizes a bilingual English/Chinese header row', async () => {
    const file = makeFile('words.csv', 'English,中文\nBook,书')
    const result = await parseImportFile(file)
    expect(result.hasHeader).toBe(true)
    expect(result.words).toEqual([{ english: 'Book', chinese: '书' }])
  })

  it('does not discard a first vocabulary row that only resembles one header label', async () => {
    const file = makeFile('words.csv', 'English,苹果\nBook,书')
    const result = await parseImportFile(file)
    expect(result.hasHeader).toBe(false)
    expect(result.words[0]).toEqual({ english: 'English', chinese: '苹果' })
  })

  it('parses JSON object arrays and pair arrays', async () => {
    const objectResult = await parseImportFile(makeFile('words.json', JSON.stringify([
      { english: 'Apple', chinese: '苹果' },
      { english: 'Book', chinese: '书' },
    ])))
    const pairResult = await parseImportFile(makeFile('pairs.json', JSON.stringify([
      ['Apple', '苹果'],
      ['Book', '书'],
    ])))
    expect(objectResult.words[0]).toEqual({ english: 'Apple', chinese: '苹果' })
    expect(pairResult.words[1]).toEqual({ english: 'Book', chinese: '书' })
  })

  it('honors a TXT separator and keeps the pair order intact', async () => {
    const result = await parseImportFile(makeFile('words.txt', 'Apple | 苹果\nBeautiful | 美丽的'), { delimiter: 'pipe' })
    expect(result.words).toEqual([
      { english: 'Apple', chinese: '苹果' },
      { english: 'Beautiful', chinese: '美丽的' },
    ])
  })

  it('keeps a continued TXT definition and an incomplete row visible', async () => {
    const result = await parseImportFile(makeFile('continued.txt', 'Apple | 水果\n也可以指苹果公司\nBook | 书\nOrphan'))
    expect(result.words).toEqual([
      { english: 'Apple', chinese: '水果 也可以指苹果公司' },
      { english: 'Book', chinese: '书' },
      { english: 'Orphan', chinese: '' },
    ])
    expect(result.sourceRows).toHaveLength(3)
    expect(result.warnings.some((warning) => warning.includes('缺少英文或中文'))).toBe(true)
  })

  it('parses loose numbered bilingual TXT and retains an unmatched last item', async () => {
    const result = await parseImportFile(makeFile('loose.txt', '1. Apple 苹果\n一种常见水果\n2. Book'))
    expect(result.words).toEqual([
      { english: 'Apple', chinese: '苹果 一种常见水果' },
      { english: 'Book', chinese: '' },
    ])
    expect(result.warnings.some((warning) => warning.includes('缺少英文或中文'))).toBe(true)
  })

  it('preserves incomplete CSV rows and reports extra fields', async () => {
    const result = await parseImportFile(makeFile('partial.csv', 'English,Chinese\nApple,\nBook,书,额外说明'))
    expect(result.words).toEqual([
      { english: 'Apple', chinese: '' },
      { english: 'Book', chinese: '书' },
    ])
    expect(result.sourceRows).toHaveLength(3)
    expect(result.warnings.some((warning) => warning.includes('格式异常'))).toBe(true)
  })

  it('loads XLSX and XLS locally and exposes sheet names for selection', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['English', 'Chinese'], ['Apple', '苹果']]), 'Vocabulary')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['English', 'Chinese'], ['Book', '书']]), 'Second')
    for (const bookType of ['xlsx', 'xls'] as const) {
      const bytes = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer
      const file = new File([bytes], `words.${bookType}`)
      const result = await parseImportFile(file, { sheetName: 'Second' })
      expect(result.sheetNames).toContain('Second')
      expect(result.words).toEqual([{ english: 'Book', chinese: '书' }])
    }
  })

  it('extracts text from a PDF locally and pairs bilingual lines without discarding a final orphan', async () => {
    const result = await parseImportFile(makeTextPdf(['Apple', '苹果', 'Book', '书', 'final note']))
    expect(result.format).toBe('pdf')
    expect(result.words).toEqual([
      { english: 'Apple', chinese: '苹果' },
      { english: 'Book', chinese: '书' },
      { english: 'final note', chinese: '' },
    ])
    expect(result.warnings.some((warning) => warning.includes('版面启发式'))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('缺少英文或中文'))).toBe(true)
  }, 15000)

  it('reports duplicate pairs while retaining both rows for the user to choose', async () => {
    const file = makeFile('duplicate.txt', 'Apple|苹果\nApple|苹果\nApple|果实')
    const result = await parseImportFile(file, { delimiter: 'pipe' })
    expect(result.words).toHaveLength(3)
    expect([...findDuplicateIndexes(result.words)]).toEqual([1])
  })
})
