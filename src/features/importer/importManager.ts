import Papa from 'papaparse'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { ImportColumn, ImportDelimiter, ImportFormat, ImportOptions, ParsedImport, WordPairDraft } from '../../types/domain'

type Matrix = string[][]

const delimiterValue: Record<Exclude<ImportDelimiter, 'auto'>, string> = {
  tab: '\t',
  comma: ',',
  chineseComma: '，',
  pipe: '|',
  colon: ':',
  semicolon: ';',
}

const englishHeader = /^(english|en|word|term|vocabulary|单词|英文|英语)$/i
const chineseHeader = /^(chinese|zh|cn|meaning|translation|definition|中文|汉语|释义|意思|翻译)$/i

function guessHeader(rows: Matrix): boolean {
  const first = rows[0] ?? []
  return first.some((value) => englishHeader.test(value.trim())) && first.some((value) => chineseHeader.test(value.trim()))
}

function guessColumns(rows: Matrix, hasHeader: boolean): [number, number] {
  const sample = rows.slice(hasHeader ? 1 : 0, Math.min(rows.length, hasHeader ? 31 : 30))
  const width = Math.max(2, ...sample.map((row) => row.length))
  const labels = rows[0] ?? []
  const scores = Array.from({ length: width }, (_, index) => {
    let english = 0
    let chinese = 0
    let filled = 0
    for (const row of sample) {
      const value = (row[index] ?? '').trim()
      if (!value) continue
      filled += 1
      if (/[A-Za-z]/.test(value)) english += 1
      if (/[\u3400-\u9fff]/.test(value)) chinese += 1
    }
    const label = (labels[index] ?? '').trim()
    return {
      english: english / Math.max(filled, 1) + (englishHeader.test(label) ? 2 : 0),
      chinese: chinese / Math.max(filled, 1) + (chineseHeader.test(label) ? 2 : 0),
    }
  })
  const english = scores.map((score, index) => ({ index, value: score.english })).sort((a, b) => b.value - a.value)[0]?.index ?? 0
  const chinese = scores.map((score, index) => ({ index, value: score.chinese })).sort((a, b) => b.value - a.value)[0]?.index ?? (english === 0 ? 1 : 0)
  return english === chinese ? [0, 1] : [english, chinese]
}

function normalizeRows(rows: Matrix): Matrix {
  return rows.map((row) => row.map((value) => String(value ?? '').replace(/^\uFEFF/, '').trim()))
}

function rowsToPreview(fileName: string, format: ImportFormat, rows: Matrix, options: ImportOptions = {}, warnings: string[] = [], sheetNames?: string[]): ParsedImport {
  const sourceRows = normalizeRows(rows).filter((row) => row.some((value) => value.length > 0))
  if (!sourceRows.length) throw new Error('文件里没有可读取的内容。')

  const hasHeader = options.hasHeader ?? guessHeader(sourceRows)
  const [suggestedEnglishColumn, suggestedChineseColumn] = guessColumns(sourceRows, hasHeader)
  const englishColumn = options.englishColumn ?? suggestedEnglishColumn
  const chineseColumn = options.chineseColumn ?? suggestedChineseColumn
  const dataRows = sourceRows.slice(hasHeader ? 1 : 0)
  const nonEmptyRows = dataRows.filter((row) => row.some((value) => value.length > 0))
  const words: WordPairDraft[] = nonEmptyRows
    .map((row) => ({ english: (row[englishColumn] ?? '').trim(), chinese: (row[chineseColumn] ?? '').trim() }))
  const incomplete = words.filter((row) => !row.english || !row.chinese).length
  const nextWarnings = [...warnings]
  if (hasHeader && options.hasHeader === undefined) nextWarnings.push('已按首行表头识别；如果首行是词条，可取消“第一行是表头”后检查结果。')
  if (incomplete) nextWarnings.push(`${incomplete} 行缺少英文或中文，请在预览中补齐或删除。`)
  if (!words.length) nextWarnings.push('暂时没有识别到词条，请检查列选择或文本分隔符。')
  const width = Math.max(...sourceRows.map((row) => row.length), 2)
  const labels = hasHeader ? sourceRows[0] : undefined
  const columns: ImportColumn[] = Array.from({ length: width }, (_, index) => ({
    index,
    label: (labels?.[index] || `第 ${index + 1} 列`).trim(),
  }))
  return {
    fileName,
    format,
    words,
    warnings: nextWarnings,
    sheetNames,
    columns,
    sourceRows,
    hasHeader,
    suggestedEnglishColumn,
    suggestedChineseColumn,
  }
}

function detectDelimiter(firstLine: string, format: ImportFormat, requested: ImportDelimiter = 'auto'): string {
  if (requested !== 'auto') return delimiterValue[requested]
  if (format === 'csv') {
    if (countOutsideQuotes(firstLine, ',') > 0) return ','
    if (countOutsideQuotes(firstLine, '\t') > 0) return '\t'
    if (countOutsideQuotes(firstLine, '，') > 0) return '，'
    if (countOutsideQuotes(firstLine, ';') > 0) return ';'
    if (countOutsideQuotes(firstLine, '|') > 0) return '|'
  }
  if (firstLine.includes('\t')) return '\t'
  if (firstLine.includes('，') && !firstLine.includes(',')) return '，'
  if (firstLine.includes('|')) return '|'
  if (firstLine.includes(';')) return ';'
  if (format === 'txt' && (firstLine.includes('：') || firstLine.includes(':')) && !firstLine.includes(',')) return firstLine.includes('：') ? '：' : ':'
  return ','
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let quoted = false
  let count = 0
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1
      else quoted = !quoted
    } else if (!quoted && line.startsWith(delimiter, index)) {
      count += 1
      index += delimiter.length - 1
    }
  }
  return count
}

function parseDelimited(text: string, delimiter: string): Matrix {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter,
    skipEmptyLines: 'greedy',
    quoteChar: '"',
    escapeChar: '"',
    dynamicTyping: false,
  })
  if (parsed.errors.some((error) => error.type === 'Quotes')) {
    throw new Error('文件里的引号格式不完整，请检查后再导入。')
  }
  return normalizeRows(parsed.data as Matrix)
}

function parseJson(text: string): Matrix {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('JSON 格式无法读取，请确认文件内容完整。')
  }
  if (!Array.isArray(data)) throw new Error('JSON 文件需要是词条数组。')
  if (!data.length) return []
  if (Array.isArray(data[0])) return (data as unknown[][]).map((row) => row.map((value) => String(value ?? '')))
  if (typeof data[0] === 'object' && data[0] !== null) {
    const records = data as Record<string, unknown>[]
    const keys = [...new Set(records.flatMap((record) => Object.keys(record)))]
    const headerIndex = keys.findIndex((key) => englishHeader.test(key))
    const chineseIndex = keys.findIndex((key) => chineseHeader.test(key))
    const englishKey = headerIndex >= 0 ? keys[headerIndex] : keys[0]
    const chineseKey = chineseIndex >= 0 ? keys[chineseIndex] : keys.find((key) => key !== englishKey)
    if (!englishKey || !chineseKey) throw new Error('JSON 词条需要包含 english 和 chinese 两个字段。')
    return [keys, ...records.map((record) => keys.map((key) => String(record[key] ?? '')))]
  }
  throw new Error('JSON 词条需要是对象数组或二维数组。')
}

async function parseExcel(file: File, options: ImportOptions): Promise<ParsedImport> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, raw: false })
  const firstSheet = workbook.SheetNames[0]
  if (!firstSheet) throw new Error('Excel 文件没有工作表。')
  const sheetName = options.sheetName ?? firstSheet
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error('找不到所选工作表。')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
    .map((row) => row.map((value) => String(value ?? '')))
  return rowsToPreview(file.name, file.name.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx', rows, options, [], workbook.SheetNames)
}

async function parsePdf(file: File): Promise<ParsedImport> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = typeof window === 'undefined'
    ? new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
    : pdfWorkerUrl
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer(), useSystemFonts: true })
  const document = await loadingTask.promise
  const pageLines: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const groups: Array<{ y: number; x: number; parts: Array<{ x: number; text: string }> }> = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const x = item.transform[4]
        const y = item.transform[5]
        let group = groups.find((candidate) => Math.abs(candidate.y - y) < 4)
        if (!group) {
          group = { y, x, parts: [] }
          groups.push(group)
        }
        group.parts.push({ x, text: item.str.trim() })
      }
      groups.sort((a, b) => b.y - a.y)
      for (const group of groups) {
        group.parts.sort((a, b) => a.x - b.x)
        pageLines.push(group.parts
          .map((part) => part.text.replace(/([\u3400-\u9fff])[\s\u00a0]+(?=[\u3400-\u9fff])/gu, '$1'))
          .join('\t'))
      }
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }

  const delimited = pageLines.filter((line) => line.includes('\t') || line.includes('|') || line.includes(',') || line.includes('，'))
  if (delimited.length) {
    const rows = delimited.map((line) => parseDelimited(line, line.includes('\t') ? '\t' : detectDelimiter(line, 'pdf'))[0] ?? [])
    return rowsToPreview(file.name, 'pdf', rows, {}, ['PDF 文本版式可能影响识别，请在预览中核对每一组。'])
  }
  const meaningful = pageLines.map((line) => line.trim()).filter(Boolean)
  const pairedLines: Matrix = []
  for (let index = 0; index + 1 < meaningful.length; index += 2) {
    const english = meaningful[index]
    const chinese = meaningful[index + 1]
    if (english !== undefined && chinese !== undefined) pairedLines.push([english, chinese])
  }
  if (!pairedLines.length) throw new Error('这个 PDF 没有可提取的文字。扫描版 PDF 的本地 OCR 尚未启用。')
  return rowsToPreview(file.name, 'pdf', pairedLines, {}, ['已按相邻两行猜测词对，请逐条检查。扫描版 PDF 目前不支持 OCR。'])
}

export async function parseImportFile(file: File, options: ImportOptions = {}): Promise<ParsedImport> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension) throw new Error('无法识别文件格式。')
  if (extension === 'xlsx' || extension === 'xls') return parseExcel(file, options)
  if (extension === 'pdf') return parsePdf(file)
  const text = await file.text()
  if (extension === 'json') return rowsToPreview(file.name, 'json', parseJson(text), options)
  if (extension === 'csv' || extension === 'txt') {
    const format = extension as 'csv' | 'txt'
    const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
    const delimiter = detectDelimiter(firstLine, format, options.delimiter)
    return rowsToPreview(file.name, format, parseDelimited(text, delimiter), options)
  }
  throw new Error('支持 CSV、XLSX、XLS、JSON、TXT 和 PDF 文件。')
}

export function findDuplicateIndexes(words: WordPairDraft[]): Set<number> {
  const seen = new Set<string>()
  const duplicates = new Set<number>()
  words.forEach((word, index) => {
    const english = word.english.trim()
    const chinese = word.chinese.trim()
    if (!english || !chinese) return
    const key = `${english.toLocaleLowerCase()}\u0000${chinese}`
    if (seen.has(key)) duplicates.add(index)
    else seen.add(key)
  })
  return duplicates
}
