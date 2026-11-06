import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchPage from './page'
import { useSearch } from '@/lib/hooks/use-search'
import { useModalManager } from '@/lib/hooks/use-modal-manager'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams('mode=search'),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/search/NotebookScopeSelector', () => ({
  NotebookScopeSelector: () => null,
}))

vi.mock('@/components/search/StreamingResponse', () => ({
  StreamingResponse: () => null,
}))

vi.mock('@/components/search/AdvancedModelsDialog', () => ({
  AdvancedModelsDialog: () => null,
}))

vi.mock('@/components/search/SaveToNotebooksDialog', () => ({
  SaveToNotebooksDialog: () => null,
}))

vi.mock('@/lib/hooks/use-search', () => ({
  useSearch: vi.fn(),
}))

vi.mock('@/lib/hooks/use-ask', () => ({
  useAsk: () => ({
    sendAsk: vi.fn(),
    isStreaming: false,
    strategy: null,
    answers: [],
    finalAnswer: '',
  }),
}))

vi.mock('@/lib/hooks/use-models', () => ({
  useModelDefaults: () => ({ data: null, isLoading: false }),
  useModels: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/lib/hooks/use-modal-manager', () => ({
  useModalManager: vi.fn(),
}))

const mockUseSearch = vi.mocked(useSearch)
const mockUseModalManager = vi.mocked(useModalManager)
const openModal = vi.fn()

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearch.mockReturnValue({
      data: {
        results: [{
          id: 'source_insight:matched-insight',
          parent_id: 'source:parent-source',
          title: 'Matched insight',
          final_score: 0.9,
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        }],
        total_count: 1,
        search_type: 'text',
      },
      isPending: false,
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useSearch>)
    mockUseModalManager.mockReturnValue({ openModal } as unknown as ReturnType<typeof useModalManager>)
  })

  it('opens the record that matched instead of its parent source', () => {
    render(<SearchPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Matched insight' }))

    expect(openModal).toHaveBeenCalledWith('insight', 'matched-insight')
  })
})

describe('SearchPage search refinements', () => {
  const result = (id: string, title: string, score: number, matches?: string[]) => ({
    id,
    parent_id: id,
    title,
    final_score: score,
    matches,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  })

  function mockSearch(results: ReturnType<typeof result>[], query = 'budget') {
    const mutate = vi.fn()
    mockUseSearch.mockReturnValue({
      data: { results, total_count: results.length, search_type: 'text' },
      variables: { query },
      isPending: false,
      mutate,
    } as unknown as ReturnType<typeof useSearch>)
    return mutate
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModalManager.mockReturnValue({ openModal } as unknown as ReturnType<typeof useModalManager>)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs text search as you type after a short pause', () => {
    vi.useFakeTimers()
    const mutate = mockSearch([])
    render(<SearchPage />)

    const input = screen.getByRole('textbox', { name: 'common.accessibility.enterSearch' })
    fireEvent.change(input, { target: { value: 'b' } })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'bud' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(mutate).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ query: 'bud', type: 'text' }))
  })

  it('keeps the input enabled and searches immediately on Enter', () => {
    const mutate = mockSearch([])
    render(<SearchPage />)

    const input = screen.getByRole('textbox', { name: 'common.accessibility.enterSearch' })
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { value: 'budget' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ query: 'budget' }))
  })

  it('shows Top Hits, filters by type and highlights matched words', () => {
    mockSearch([
      result('source:a', 'Budget 2026', 0.9, ['The budget review is due Friday']),
      result('note:b', 'Budget notes', 0.8),
      result('source:c', 'Planning', 0.7),
      result('source_insight:d', 'Summary - Planning', 0.6),
      result('source:e', 'Archive', 0.5),
    ])
    render(<SearchPage />)

    expect(screen.getByText('searchPage.topHits')).toBeInTheDocument()
    expect(screen.getByText('searchPage.moreResults')).toBeInTheDocument()
    const marks = screen.getAllByText((_, el) => el?.tagName === 'MARK').map((m) => m.textContent)
    expect(marks).toEqual(expect.arrayContaining(['Budget', 'budget']))

    fireEvent.click(screen.getByRole('button', { name: 'searchPage.filterNotes · 1' }))

    expect(screen.queryByText('searchPage.topHits')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Budget notes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Planning' })).not.toBeInTheDocument()
  })

  it('moves focus from the input into the results with the arrow keys', () => {
    mockSearch([result('source:a', 'Budget 2026', 0.9), result('note:b', 'Budget notes', 0.8)])
    render(<SearchPage />)

    const input = screen.getByRole('textbox', { name: 'common.accessibility.enterSearch' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Budget 2026' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Budget 2026' }), { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Budget notes' })).toHaveFocus()
  })
})
