import { describe, expect, it } from 'vitest'
import {
  dateRange,
  excerpt,
  highlightNeedles,
  highlightSegments,
  isEmptyQuery,
  parseNoteQuery,
  searchNotes,
  type SearchableNote,
} from './note-search'

// Wednesday 2026-11-04, 12:00 local time
const NOW = new Date(2026, 10, 4, 12, 0, 0).getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

function note(id: string, title: string, content: string, extra: Partial<SearchableNote> = {}): SearchableNote {
  return {
    id,
    title,
    content,
    note_type: 'human',
    created: daysAgo(10),
    updated: daysAgo(1),
    ...extra,
  }
}

describe('parseNoteQuery', () => {
  it('splits words, phrases, type and date filters', () => {
    const q = parseNoteQuery('Budget "Quarterly Review" is:ai modified this week', NOW)
    expect(q.terms).toEqual(['budget'])
    expect(q.phrases).toEqual(['quarterly review'])
    expect(q.kind).toBe('ai')
    expect(q.date?.field).toBe('updated')
  })

  it('uses the creation date for "created" phrases', () => {
    expect(parseNoteQuery('created last week', NOW).date?.field).toBe('created')
  })

  it('counts an unclosed quote while typing and treats one quoted word as a term', () => {
    expect(parseNoteQuery('"road map', NOW).phrases).toEqual(['road map'])
    expect(parseNoteQuery('"roadmap"', NOW).terms).toEqual(['roadmap'])
  })

  it('folds accents and case', () => {
    expect(parseNoteQuery('CAFÉ', NOW).terms).toEqual(['cafe'])
  })

  it('recognises an empty query', () => {
    expect(isEmptyQuery(parseNoteQuery('   ', NOW))).toBe(true)
    expect(isEmptyQuery(parseNoteQuery('is:human', NOW))).toBe(false)
  })

  it('does not treat words that merely contain a date word as a filter', () => {
    const q = parseNoteQuery('todayish', NOW)
    expect(q.date).toBeNull()
    expect(q.terms).toEqual(['todayish'])
  })
})

describe('dateRange', () => {
  it('starts weeks on Monday and ends ranges tomorrow', () => {
    const range = dateRange('this week', NOW)!
    expect(new Date(range.from)).toEqual(new Date(2026, 10, 2))
    expect(new Date(range.to)).toEqual(new Date(2026, 10, 5))
  })

  it('handles last N days inclusive of today', () => {
    const range = dateRange('last 7 days', NOW)!
    expect(new Date(range.from)).toEqual(new Date(2026, 9, 29))
  })
})

describe('searchNotes', () => {
  const notes = [
    note('note:1', 'Weekly team meeting', 'Agenda: budget review and hiring'),
    note('note:2', 'Groceries', 'Milk, eggs, coffee from the café', { updated: daysAgo(0) }),
    note('note:3', 'Research summary', 'Notes from the meeting with the vendor', { note_type: 'ai' }),
    note('note:4', 'Ideas', 'Meet Sam about the roadmap', { updated: daysAgo(40) }),
    note('note:5', 'Meeting minutes', 'Decisions and action items', { updated: daysAgo(3) }),
  ]

  it('prefix-matches words as you type', () => {
    expect(searchNotes(notes, 'meet', NOW).total).toBe(4)
  })

  it('pulls title matches into Top Hits when there are more than three matches', () => {
    const result = searchNotes(notes, 'meet', NOW)
    expect(result.topHits.map((h) => h.note.title)).toEqual([
      'Weekly team meeting',
      'Meeting minutes',
      'Research summary',
    ])
    expect(result.results.map((h) => h.note.id)).toEqual(['note:4'])
  })

  it('lists matches newest first with no Top Hits for small result sets', () => {
    const result = searchNotes(notes, 'budget', NOW)
    expect(result.topHits).toEqual([])
    expect(result.results.map((h) => h.note.id)).toEqual(['note:1'])
  })

  it('requires every word to match', () => {
    expect(searchNotes(notes, 'meeting vendor', NOW).results.map((h) => h.note.id)).toEqual(['note:3'])
  })

  it('does not match inside words', () => {
    expect(searchNotes(notes, 'eting', NOW).total).toBe(0)
  })

  it('matches accent-insensitively', () => {
    expect(searchNotes(notes, 'cafe', NOW).results.map((h) => h.note.id)).toEqual(['note:2'])
  })

  it('matches phrases as a whole', () => {
    expect(searchNotes(notes, '"budget review"', NOW).total).toBe(1)
    expect(searchNotes(notes, '"review budget"', NOW).total).toBe(0)
  })

  it('filters by note type and edit date', () => {
    expect(searchNotes(notes, 'is:ai', NOW).results.map((h) => h.note.id)).toEqual(['note:3'])
    expect(searchNotes(notes, 'modified today', NOW).results.map((h) => h.note.id)).toEqual(['note:2'])
    expect(searchNotes(notes, 'meet last 7 days', NOW).total).toBe(3)
  })

  it('ignores notes with an unparseable date when a date filter is set', () => {
    const broken = [note('note:9', 'Odd', 'x', { updated: 'not a date' })]
    expect(searchNotes(broken, 'modified this month', NOW).total).toBe(0)
  })
})

describe('highlightSegments', () => {
  it('marks matches at word starts, keeping original case and accents', () => {
    expect(highlightSegments('Coffee at the Café', ['cafe'])).toEqual([
      { text: 'Coffee at the ', match: false },
      { text: 'Café', match: true },
    ])
  })

  it('marks prefixes and merges overlapping needles', () => {
    expect(highlightSegments('Meeting notes', ['meet', 'meeting'])).toEqual([
      { text: 'Meeting', match: true },
      { text: ' notes', match: false },
    ])
  })

  it('handles decomposed accents in the source text', () => {
    const segments = highlightSegments('Café au lait', ['cafe'])
    // The combining accent stays inside the mark with its base letter.
    expect(segments[0]).toEqual({ text: 'Café', match: true })
  })

  it('returns plain text when nothing matches', () => {
    expect(highlightSegments('Nothing here', ['zebra'])).toEqual([{ text: 'Nothing here', match: false }])
  })
})

describe('excerpt and highlightNeedles', () => {
  it('centres the excerpt on the first match', () => {
    const long = `${'lorem ipsum '.repeat(30)}the deadline is Friday ${'dolor sit '.repeat(30)}`
    const text = excerpt(long, ['deadline'], 40)
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    expect(text).toContain('deadline')
  })

  it('keeps short text whole', () => {
    expect(excerpt('Short\n\nnote', ['note'])).toBe('Short note')
  })

  it('returns highlight needles without filter tokens', () => {
    expect(highlightNeedles('"road map" budget is:ai today')).toEqual(['road map', 'budget'])
  })
})
