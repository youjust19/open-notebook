/**
 * Notes-app style search over notes that are already loaded in the browser.
 *
 * Modelled on Apple Notes / OneNote search: results update as you type, words
 * are prefix-matched ("meet" finds "meeting"), case and accents are ignored
 * ("cafe" finds "Café"), and the strongest matches are surfaced as Top Hits.
 *
 * Query syntax:
 *   meet budget          every word must match (prefix match)
 *   "budget review"      exact phrase (an unclosed quote counts while typing)
 *   is:ai  is:human      note type filter (type:ai / type:human also work)
 *   modified today       date filter on the last edit; also yesterday, this week,
 *   created last week    last week, this month, last month, last N days.
 *                        The "created" prefix filters on creation date instead.
 */

export type NoteKind = 'ai' | 'human'

export interface DateFilter {
  field: 'created' | 'updated'
  /** Inclusive start, epoch ms. */
  from: number
  /** Exclusive end, epoch ms. */
  to: number
}

export interface NoteQuery {
  /** Folded words, each prefix-matched. */
  terms: string[]
  /** Folded multi-word phrases, each matched as a whole. */
  phrases: string[]
  kind: NoteKind | null
  date: DateFilter | null
}

export interface SearchableNote {
  id: string
  title: string | null
  content: string | null
  note_type: string | null
  created: string
  updated: string
}

export interface NoteHit<T extends SearchableNote = SearchableNote> {
  note: T
  score: number
}

export interface NoteSearchResult<T extends SearchableNote = SearchableNote> {
  /** Best matches by score; only filled when a text query has more than TOP_HIT_COUNT matches. */
  topHits: NoteHit<T>[]
  /** Remaining matches, most recently edited first. */
  results: NoteHit<T>[]
  total: number
}

export const TOP_HIT_COUNT = 3

const DAY_MS = 86_400_000

const DATE_RE =
  /(?<![\p{L}\p{N}])(?:(created|modified|updated|edited)\s+)?(today|yesterday|this\s+week|last\s+week|this\s+month|last\s+month|(?:last|past)\s+\d{1,3}\s+days?)(?![\p{L}\p{N}])/iu

const WORD_CHAR = /[\p{L}\p{N}]/u

/** Lower-cases and strips diacritics so "Café" and "cafe" compare equal. */
export function fold(text: string | null | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

/** Splits text into folded word tokens. */
export function words(text: string | null | undefined): string[] {
  return fold(text).match(/[\p{L}\p{N}]+/gu) ?? []
}

function startOfDay(t: number): Date {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

/** Converts a date phrase into a [from, to) range in local time. Weeks start on Monday. */
export function dateRange(phrase: string, now: number = Date.now()): { from: number; to: number } | null {
  const p = phrase.toLowerCase().replace(/\s+/g, ' ')
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)
  const weekStart = addDays(today, -((today.getDay() + 6) % 7))
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const span = (from: Date, to: Date) => ({ from: from.getTime(), to: to.getTime() })

  if (p === 'today') return span(today, tomorrow)
  if (p === 'yesterday') return span(addDays(today, -1), today)
  if (p === 'this week') return span(weekStart, tomorrow)
  if (p === 'last week') return span(addDays(weekStart, -7), weekStart)
  if (p === 'this month') return span(monthStart, tomorrow)
  if (p === 'last month') {
    return span(new Date(today.getFullYear(), today.getMonth() - 1, 1), monthStart)
  }
  const n = Number(p.match(/\d+/)?.[0])
  if (n > 0) return span(addDays(today, -(n - 1)), tomorrow)
  return null
}

export function parseNoteQuery(input: string | null | undefined, now: number = Date.now()): NoteQuery {
  const query: NoteQuery = { terms: [], phrases: [], kind: null, date: null }
  let rest = String(input ?? '')

  const m = rest.match(DATE_RE)
  if (m && m.index !== undefined) {
    const range = dateRange(m[2], now)
    if (range) {
      query.date = { field: m[1]?.toLowerCase() === 'created' ? 'created' : 'updated', ...range }
      rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`
    }
  }

  rest = rest.replace(/"([^"]*)"?/g, (_, phrase: string) => {
    const w = words(phrase)
    if (w.length > 1) query.phrases.push(w.join(' '))
    else if (w.length === 1) query.terms.push(w[0])
    return ' '
  })

  for (const token of rest.split(/\s+/)) {
    if (!token) continue
    const kind = token.match(/^(?:is|type):(ai|human)$/i)
    if (kind) {
      query.kind = kind[1].toLowerCase() as NoteKind
      continue
    }
    query.terms.push(...words(token))
  }
  return query
}

/** True when the query has words or phrases, as opposed to filters only. */
export function hasTextCriteria(query: NoteQuery): boolean {
  return query.terms.length > 0 || query.phrases.length > 0
}

export function isEmptyQuery(query: NoteQuery): boolean {
  return !hasTextCriteria(query) && query.kind === null && query.date === null
}

/** Words and phrases to highlight for a raw query string. */
export function highlightNeedles(input: string | null | undefined): string[] {
  const query = parseNoteQuery(input)
  return [...query.phrases, ...query.terms]
}

/** Index of `needle` in folded `haystack` where the match starts a word, or -1. */
function indexAtWordStart(haystack: string, needle: string, from = 0): number {
  let i = haystack.indexOf(needle, from)
  while (i !== -1) {
    if (i === 0 || !WORD_CHAR.test(haystack[i - 1])) return i
    i = haystack.indexOf(needle, i + 1)
  }
  return -1
}

function countAtWordStart(haystack: string, needle: string): number {
  let count = 0
  let i = indexAtWordStart(haystack, needle)
  while (i !== -1) {
    count++
    i = indexAtWordStart(haystack, needle, i + needle.length)
  }
  return count
}

function timeOf(value: string): number {
  const t = Date.parse(value)
  return Number.isNaN(t) ? 0 : t
}

/** Scores one note, or returns null when it does not match every criterion. */
export function scoreNote(note: SearchableNote, query: NoteQuery, now: number = Date.now()): number | null {
  if (query.kind && (note.note_type === 'ai' ? 'ai' : 'human') !== query.kind) return null

  if (query.date) {
    const t = timeOf(query.date.field === 'created' ? note.created : note.updated)
    if (!t || t < query.date.from || t >= query.date.to) return null
  }

  const title = fold(note.title)
  const content = fold(note.content)
  let titleHits = 0
  let bodyHits = 0

  for (const needle of [...query.terms, ...query.phrases]) {
    const inTitle = countAtWordStart(title, needle)
    const inBody = countAtWordStart(content, needle)
    if (inTitle + inBody === 0) return null
    if (inTitle) titleHits++
    bodyHits += Math.min(inBody, 5)
  }

  const criteria = query.terms.length + query.phrases.length
  const ageDays = Math.max(0, (now - timeOf(note.updated)) / DAY_MS)
  const recency = Math.exp(-ageDays / 30)
  if (criteria === 0) return recency

  // Mirrors Apple's description of Top Hits: title matches and recent edits rank first.
  const titleScore = titleHits / criteria
  const bodyScore = Math.min(1, bodyHits / (criteria * 3))
  return 0.5 * titleScore + 0.3 * bodyScore + 0.2 * recency
}

const byUpdatedDesc = (a: NoteHit, b: NoteHit) =>
  timeOf(b.note.updated) - timeOf(a.note.updated) || a.note.id.localeCompare(b.note.id)

export function searchNotes<T extends SearchableNote>(
  notes: readonly T[],
  input: string | NoteQuery,
  now: number = Date.now()
): NoteSearchResult<T> {
  const query = typeof input === 'string' ? parseNoteQuery(input, now) : input
  const hits: NoteHit<T>[] = []
  for (const note of notes) {
    const score = scoreNote(note, query, now)
    if (score !== null) hits.push({ note, score })
  }

  if (!hasTextCriteria(query) || hits.length <= TOP_HIT_COUNT) {
    return { topHits: [], results: hits.sort(byUpdatedDesc), total: hits.length }
  }

  const ranked = [...hits].sort((a, b) => b.score - a.score || byUpdatedDesc(a, b))
  return {
    topHits: ranked.slice(0, TOP_HIT_COUNT),
    results: ranked.slice(TOP_HIT_COUNT).sort(byUpdatedDesc),
    total: hits.length,
  }
}

export interface TextSegment {
  text: string
  match: boolean
}

/**
 * Folds text while remembering where each folded character came from, so
 * matches found in folded text map back to the original string.
 */
function foldWithMap(text: string): { folded: string; origin: number[] } {
  let folded = ''
  const origin: number[] = []
  let i = 0
  for (const ch of text) {
    const f = fold(ch)
    for (let k = 0; k < f.length; k++) origin.push(i)
    folded += f
    i += ch.length
  }
  origin.push(text.length)
  return { folded, origin }
}

/** Splits `text` into plain and matching segments, case- and accent-insensitively. */
export function highlightSegments(text: string, needles: readonly string[]): TextSegment[] {
  if (!text) return []
  const wanted = [...new Set(needles.filter(Boolean))]
  if (wanted.length === 0) return [{ text, match: false }]

  const { folded, origin } = foldWithMap(text)
  const ranges: Array<[number, number]> = []
  for (const needle of wanted) {
    let i = indexAtWordStart(folded, needle)
    while (i !== -1) {
      ranges.push([origin[i], origin[i + needle.length]])
      i = indexAtWordStart(folded, needle, i + needle.length)
    }
  }
  if (ranges.length === 0) return [{ text, match: false }]

  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const segments: TextSegment[] = []
  let pos = 0
  for (const [start, end] of ranges) {
    if (end <= pos) continue
    const from = Math.max(start, pos)
    if (from > pos) segments.push({ text: text.slice(pos, from), match: false })
    segments.push({ text: text.slice(from, end), match: true })
    pos = end
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), match: false })
  return segments
}

/**
 * A short excerpt of `text` around the first match, with whitespace collapsed.
 * Starts at the beginning of the text when nothing matches.
 */
export function excerpt(text: string | null | undefined, needles: readonly string[], radius = 70): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''

  const segments = highlightSegments(clean, needles)
  const first = segments.findIndex((s) => s.match)
  const matchAt = first <= 0 ? 0 : segments.slice(0, first).reduce((n, s) => n + s.text.length, 0)

  let start = Math.max(0, matchAt - radius)
  if (start > 0) {
    const space = clean.indexOf(' ', start)
    if (space !== -1 && space < matchAt) start = space + 1
  }
  const end = Math.min(clean.length, start + radius * 2)
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`
}
