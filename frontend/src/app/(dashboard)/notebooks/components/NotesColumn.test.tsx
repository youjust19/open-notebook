import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteResponse } from '@/lib/types/api'
import { NotesColumn } from './NotesColumn'

interface MockNoteEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  note?: NoteResponse
}

vi.mock('./NoteEditorDialog', () => ({
  NoteEditorDialog: ({
    open,
    onOpenChange,
    notebookId,
    note,
  }: MockNoteEditorDialogProps) => (
    <div
      data-testid="note-editor-dialog"
      data-open={String(open)}
      data-notebook-id={notebookId}
      data-note-id={note?.id ?? ''}
    >
      <button onClick={() => onOpenChange(false)}>close editor</button>
    </div>
  ),
}))

vi.mock('@/lib/hooks/use-notes', () => ({
  useDeleteNote: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/stores/notebook-columns-store', () => ({
  useNotebookColumnsStore: () => ({
    notesCollapsed: false,
    toggleNotes: vi.fn(),
  }),
}))

const notebookId = 'notebook:123'
const existingNote: NoteResponse = {
  id: 'note:456',
  title: 'Existing note',
  content: 'Existing note content',
  note_type: 'human',
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
}

function renderNotes(notes: NoteResponse[]) {
  render(
    <NotesColumn
      notes={notes}
      isLoading={false}
      notebookId={notebookId}
    />
  )
  return screen.getByTestId('note-editor-dialog')
}

describe('NotesColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens, closes, and reopens the editor in create mode with loaded notes', () => {
    const editor = renderNotes([existingNote])

    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-notebook-id', notebookId)
    expect(editor).toHaveAttribute('data-note-id', '')

    fireEvent.click(screen.getByText('close editor'))
    expect(editor).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByText('common.writeNote'))
    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', '')
  })

  it('opens the editor in create mode when the notes list is empty', () => {
    const editor = renderNotes([])

    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-notebook-id', notebookId)
    expect(editor).toHaveAttribute('data-note-id', '')
  })

  it('clears the selected note before opening the editor in create mode', () => {
    const editor = renderNotes([existingNote])

    fireEvent.click(screen.getByText(existingNote.title!))
    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', existingNote.id)

    fireEvent.click(screen.getByText('close editor'))
    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', '')
  })
})

describe('NotesColumn search', () => {
  const now = Date.now()
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString()
  const notes: NoteResponse[] = [
    { id: 'note:1', title: 'Weekly team meeting', content: 'Budget review', note_type: 'human', created: iso(9), updated: iso(2) },
    { id: 'note:2', title: 'Café visit', content: 'Coffee tasting notes', note_type: 'human', created: iso(9), updated: iso(0) },
    { id: 'note:3', title: 'Research summary', content: 'From the meeting with the vendor', note_type: 'ai', created: iso(9), updated: iso(3) },
    { id: 'note:4', title: 'Meeting minutes', content: 'Decisions', note_type: 'human', created: iso(9), updated: iso(4) },
    { id: 'note:5', title: 'Ideas', content: 'Meet Sam', note_type: 'human', created: iso(9), updated: iso(40) },
  ]

  const searchBox = () => screen.getByRole('searchbox', { name: 'notebooks.searchNotesLabel' })
  const titles = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides the search box when the notebook has no notes', () => {
    renderNotes([])
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('filters as you type, highlights matches and shows Top Hits', () => {
    renderNotes(notes)

    fireEvent.change(searchBox(), { target: { value: 'meet' } })

    expect(screen.getByRole('status')).toHaveTextContent('notebooks.notesMatchCount')
    expect(screen.getByText('notebooks.topHits')).toBeInTheDocument()
    expect(titles()).toEqual(['Weekly team meeting', 'Meeting minutes', 'Research summary', 'Ideas'])
    // The typed prefix is marked inside the longer word ("[meet]ing").
    expect(screen.getAllByText((_, el) => el?.tagName === 'MARK').map((m) => m.textContent)).toContain('meet')
  })

  it('matches accent-insensitively', () => {
    renderNotes(notes)
    fireEvent.change(searchBox(), { target: { value: 'cafe' } })
    expect(titles()).toEqual(['Café visit'])
  })

  it('shows an empty state when nothing matches', () => {
    renderNotes(notes)
    fireEvent.change(searchBox(), { target: { value: 'zebra' } })
    expect(screen.getByText('notebooks.noNotesMatch')).toBeInTheDocument()
  })

  it('toggles suggested filters into the query', () => {
    renderNotes(notes)

    const aiChip = screen.getByRole('button', { name: 'notebooks.filterAiNotes' })
    fireEvent.click(aiChip)

    expect(searchBox()).toHaveValue('is:ai')
    expect(aiChip).toHaveAttribute('aria-pressed', 'true')
    expect(titles()).toEqual(['Research summary'])

    fireEvent.click(aiChip)
    expect(searchBox()).toHaveValue('')
    expect(titles()).toHaveLength(notes.length)
  })

  it('opens the active result with Enter after arrow-key navigation', () => {
    const editor = renderNotes(notes)

    fireEvent.change(searchBox(), { target: { value: 'meet' } })
    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', 'note:4')
  })

  it('clears the search with Escape', () => {
    renderNotes(notes)
    fireEvent.change(searchBox(), { target: { value: 'meet' } })
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect(searchBox()).toHaveValue('')
    expect(screen.queryByText('notebooks.topHits')).not.toBeInTheDocument()
  })
})
