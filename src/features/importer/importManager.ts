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

function detectDelimiter(text: string, format: ImportFormat, requested: ImportDelimiter = 'auto'): string {
  if (requested !== 'auto') return delimiterValue[requested]
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 40)
  const candidates = format === 'csv'
    ? [',', '\t', '，', ';', '|']
    : ['\t', '|', '，', ';', '：', ':', ',']
  const scores = candidates.map((delimiter) => {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter)).filter((count) => count > 0)
    const coverage = counts.length
    const total = counts.reduce((sum, count) => sum + count, 0)
    const frequency = new Map<number, number>()
    counts.forEach((count) => frequency.set(count, (frequency.get(count) ?? 0) + 1))
    const consistency = Math.max(0, ...frequency.values())
    return { delimiter, coverage, total, consistency }
  }).sort((a, b) => b.coverage - a.coverage || b.consistency - a.consistency || b.total - a.total)
  const best = scores[0]
  if (best && best.coverage > 0 && (best.coverage / Math.max(lines.length, 1) >= 0.5 || lines.length <= 2)) return best.delimiter
  return format === 'csv' ? ',' : ''
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

function parseDelimited(text: string, delimiter: string, warnings: string[] = []): Matrix {
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
  if (parsed.errors.length) {
    const details = [...new Set(parsed.errors.map((error) => `${error.type}${error.row === undefined ? '' : `（第 ${error.row + 1} 行）`}`))]
    warnings.push(`解析器报告 ${parsed.errors.length} 处格式异常：${details.slice(0, 4).join('、')}。请逐行核对预览。`)
  }
  const rows = normalizeRows(parsed.data as Matrix)
  const rowWidths = [...new Set(rows.filter((row) => row.some((value) => value.length > 0)).map((row) => row.length))]
  if (rowWidths.length > 1) {
    warnings.push(`检测到各行列数不一致，可能有 ${rowWidths.join('、')} 列字段；这属于格式异常，请核对原始内容和预览中的列映射。`)
  }
  return rows
}

function valueToCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
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
  if (Array.isArray(data[0])) return (data as unknown[][]).map((row) => Array.isArray(row) ? row.map(valueToCell) : [valueToCell(row)])
  if (data.some((value) => typeof value === 'object' && value !== null)) {
    const records = data.map((value) => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null)
    const keys = [...new Set(records.flatMap((record) => record ? Object.keys(record) : []))]
    const headerIndex = keys.findIndex((key) => englishHeader.test(key))
    const chineseIndex = keys.findIndex((key) => chineseHeader.test(key))
    const englishKey = headerIndex >= 0 ? keys[headerIndex] : keys[0]
    const chineseKey = chineseIndex >= 0 ? keys[chineseIndex] : keys.find((key) => key !== englishKey)
    if (!englishKey || !chineseKey) throw new Error('JSON 词条需要包含 english 和 chinese 两个字段。')
    return [keys, ...records.map((record, index) => record
      ? keys.map((key) => valueToCell(record[key]))
      : [valueToCell(data[index]), ...keys.slice(1).map(() => '')])]
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
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true })
    .map((row) => row.map((value) => String(value ?? '')))
  return rowsToPreview(file.name, file.name.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx', rows, options, [], workbook.SheetNames)
}

function hasChinese(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

function hasEnglish(value: string): boolean {
  return /[A-Za-z]/u.test(value)
}

function stripEntryMarker(value: string): string {
  return value.replace(/^\s*(?:[（(\[]\s*\d+\s*[）)\]]|\d+\s*[.、)）:：])\s*/u, '').trim()
}

function splitMixedLine(value: string): [string, string] | undefined {
  const line = value.trim()
  if (!hasEnglish(line) || !hasChinese(line)) return undefined
  const firstChinese = line.search(/[\u3400-\u9fff]/u)
  if (firstChinese <= 0) return undefined
  const english = stripEntryMarker(line.slice(0, firstChinese).replace(/[\t|,:;：，]+\s*$/u, ''))
  const chinese = line.slice(firstChinese).trim()
  return english && chinese ? [english, chinese] : undefined
}

function mergeContinuationRows(rows: Matrix): Matrix {
  const result: Matrix = []
  for (const source of normalizeRows(rows)) {
    const row = [...source]
    const occupied = row.map((cell) => cell.trim().length > 0)
    if (!occupied.some(Boolean)) continue
    if (row.length > 1 && occupied.slice(1).some(Boolean)) {
      result.push(row)
      continue
    }

    const text = row.find((cell) => cell.trim())?.trim() ?? ''
    const previous = result[result.length - 1]
    if (text && hasEnglish(text) && hasChinese(text)) {
      const mixed = splitMixedLine(text)
      if (mixed) {
        result.push([mixed[0], mixed[1], text])
        continue
      }
    }
    if (text && hasChinese(text) && previous && previous.length > 1 && previous[1]?.trim() && !/^\s*(?:[（(\[]\s*\d+\s*[）)\]]|\d+\s*[.、)）:：])/u.test(text)) {
      previous[1] = `${previous[1].trim()} ${text}`.replace(/\s+/gu, ' ').trim()
      continue
    }
    result.push([text, ...row.slice(1)])
  }
  return result
}

function parseLooseText(text: string): { rows: Matrix; warnings: string[] } {
  const rows: Matrix = []
  const warnings: string[] = ['TXT 未检测到稳定分隔符，已按中英混排和连续释义规则整理；请检查每一行。']
  let pendingEnglish = ''

  const flushPending = () => {
    if (!pendingEnglish) return
    rows.push([pendingEnglish, '', pendingEnglish])
    pendingEnglish = ''
  }

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const mixed = splitMixedLine(line)
    if (mixed) {
      if (pendingEnglish) {
        rows.push([pendingEnglish, mixed[1], `${pendingEnglish}\n${line}`])
        pendingEnglish = ''
      } else {
        rows.push([mixed[0], mixed[1], line])
      }
      continue
    }

    if (hasChinese(line) && !hasEnglish(line)) {
      if (pendingEnglish) {
        rows.push([pendingEnglish, line, `${pendingEnglish}\n${line}`])
        pendingEnglish = ''
      } else if (rows.length && rows[rows.length - 1]?.[1]?.trim() && !/^\s*(?:[（(\[]\s*\d+\s*[）)\]]|\d+\s*[.、)）:：])/u.test(line)) {
        rows[rows.length - 1]![1] = `${rows[rows.length - 1]![1]} ${line}`.replace(/\s+/gu, ' ').trim()
        rows[rows.length - 1]![2] = `${rows[rows.length - 1]![2] ?? ''}\n${line}`.trim()
      } else {
        rows.push(['', line, line])
      }
      continue
    }

    if (hasEnglish(line) && !hasChinese(line)) {
      if (pendingEnglish) flushPending()
      pendingEnglish = stripEntryMarker(line) || line
      continue
    }

    if (pendingEnglish) flushPending()
    rows.push(['', line, line])
  }
  flushPending()
  return { rows, warnings }
}

function pdfLineToPair(line: string): { english: string; chinese: string } | undefined {
  const cells = line.split('\t').map((cell) => cell.trim()).filter(Boolean)
  if (cells.length > 1) {
    const englishParts: string[] = []
    const chineseParts: string[] = []
    for (const cell of cells) {
      const mixed = splitMixedLine(cell)
      if (mixed) {
        englishParts.push(mixed[0])
        chineseParts.push(mixed[1])
      } else if (hasChinese(cell)) chineseParts.push(cell)
      else if (hasEnglish(cell) || /^\d+$/u.test(cell)) englishParts.push(cell)
      else if (chineseParts.length) chineseParts.push(cell)
      else englishParts.push(cell)
    }
    const english = stripEntryMarker(englishParts.join(' ').replace(/\s+/gu, ' '))
    const chinese = chineseParts.join(' ').replace(/\s+/gu, ' ').trim()
    if (english && chinese) return { english, chinese }
  }
  const mixed = splitMixedLine(line.replace(/\s+/gu, ' '))
  if (mixed) return { english: mixed[0], chinese: mixed[1] }
  return undefined
}

function normalizePdfChineseSpacing(value: string): string {
  return value.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
}

function parsePdfLines(lines: string[]): { rows: Matrix; warnings: string[] } {
  const rows: Matrix = []
  const warnings: string[] = ['PDF 使用本地文字和版面启发式提取。请核对编号、分栏和长释义；未识别的文字会作为待检查行保留。']
  let pendingEnglish = ''
  const flushPending = () => {
    if (!pendingEnglish) return
    rows.push([pendingEnglish, '', pendingEnglish])
    pendingEnglish = ''
  }

  for (const rawLine of lines) {
    const line = normalizePdfChineseSpacing(rawLine.trim())
    if (!line) continue
    const pair = pdfLineToPair(line)
    if (pair) {
      if (pendingEnglish) {
        const pending = pendingEnglish
        pendingEnglish = ''
        rows.push([`${pending} ${pair.english}`.replace(/\s+/gu, ' ').trim(), pair.chinese, `${pending}\n${line}`])
      } else {
        rows.push([pair.english, pair.chinese, line])
      }
      continue
    }

    if (hasChinese(line) && !hasEnglish(line)) {
      if (pendingEnglish) {
        rows.push([pendingEnglish, line, `${pendingEnglish}\n${line}`])
        pendingEnglish = ''
      } else if (rows.length && rows[rows.length - 1]?.[1]?.trim() && !/^\s*(?:[（(\[]\s*\d+\s*[）)\]]|\d+\s*[.、)）:：])/u.test(line)) {
        const previous = rows[rows.length - 1]!
        previous[1] = `${previous[1]} ${line}`.replace(/\s+/gu, ' ').trim()
        previous[2] = `${previous[2] ?? ''}\n${line}`.trim()
      } else {
        rows.push(['', line, line])
      }
      continue
    }

    if (hasEnglish(line) && !hasChinese(line)) {
      if (pendingEnglish) flushPending()
      pendingEnglish = stripEntryMarker(line) || line
      continue
    }

    if (pendingEnglish) flushPending()
    rows.push(['', line, line])
  }
  flushPending()
  return { rows, warnings }
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
        pageLines.push(group.parts.map((part) => part.text).join('\t'))
      }
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }

  const meaningful = pageLines.map((line) => line.trim()).filter(Boolean)
  if (!meaningful.length) throw new Error('这个 PDF 没有可提取的文字。它可能是扫描件；当前本地版本不包含 OCR，不会猜测或补写释义。')
  const parsed = parsePdfLines(meaningful)
  return rowsToPreview(file.name, 'pdf', parsed.rows, {}, parsed.warnings)
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
    const warnings: string[] = []
    const delimiter = detectDelimiter(text, format, options.delimiter)
    if (!delimiter && format === 'txt') {
      const parsed = parseLooseText(text)
      return rowsToPreview(file.name, format, parsed.rows, options, parsed.warnings)
    }
    const rows = parseDelimited(text, delimiter, warnings)
    const normalizedRows = format === 'txt' ? mergeContinuationRows(rows) : rows
    if (format === 'txt' && JSON.stringify(normalizedRows) !== JSON.stringify(rows)) {
      warnings.push('TXT 中存在续行或中英混排行，已按启发式合并；请在预览中检查合并结果。')
    }
    return rowsToPreview(file.name, format, normalizedRows, options, warnings)
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
