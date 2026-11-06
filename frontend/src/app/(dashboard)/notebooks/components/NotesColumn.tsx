'use client'

import { useState, useMemo, useDeferredValue, useRef } from 'react'
import { NoteResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, StickyNote, Bot, User, MoreVertical, Trash2, ListChecks, ChevronDown, Search, X } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { HighlightedText } from '@/components/common/HighlightedText'
import { Badge } from '@/components/ui/badge'
import { NoteEditorDialog } from './NoteEditorDialog'
import { getDateLocale } from '@/lib/utils/date-locale'
import { formatDistanceToNow } from 'date-fns'
import { ContextToggle } from '@/components/common/ContextToggle'
import type { NoteContextMode } from '../[id]/page'
import type { NoteContextDefault } from '@/lib/utils/source-context'
import { useDeleteNote } from '@/lib/hooks/use-notes'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import {
  excerpt,
  hasTextCriteria,
  isEmptyQuery,
  parseNoteQuery,
  searchNotes,
} from '@/lib/utils/note-search'

interface NotesColumnProps {
  notes?: NoteResponse[]
  isLoading: boolean
  notebookId: string
  contextSelections?: Record<string, NoteContextMode>
  onContextModeChange?: (noteId: string, mode: NoteContextMode) => void
  onBulkContextModeChange?: (action: NoteContextDefault) => void
}

/** Suggested searches, shown as chips under the search box (like Apple Notes). */
const SUGGESTIONS = [
  { token: 'is:ai', labelKey: 'notebooks.filterAiNotes' },
  { token: 'is:human', labelKey: 'notebooks.filterHumanNotes' },
  { token: 'modified today', labelKey: 'notebooks.filterEditedToday' },
  { token: 'modified this week', labelKey: 'notebooks.filterEditedThisWeek' },
] as const

function hasToken(query: string, token: string): boolean {
  return ` ${query.toLowerCase().replace(/\s+/g, ' ')} `.includes(` ${token} `)
}

function toggleToken(query: string, token: string): string {
  const normalized = query.replace(/\s+/g, ' ').trim()
  if (hasToken(normalized, token)) {
    return ` ${normalized} `.replace(new RegExp(` ${token} `, 'i'), ' ').trim()
  }
  return normalized ? `${normalized} ${token}` : token
}

export function NotesColumn({
  notes,
  isLoading,
  notebookId,
  contextSelections,
  onContextModeChange,
  onBulkContextModeChange
}: NotesColumnProps) {
  const { t, language } = useTranslation()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponse | undefined>()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const deleteNote = useDeleteNote()

  // Collapsible column state
  const { notesCollapsed, toggleNotes } = useNotebookColumnsStore()
  const notesLabel = t('common.notes')
  const collapseButton = useMemo(
    () => createCollapseButton(toggleNotes, notesLabel),
    [toggleNotes, notesLabel]
  )

  // Search runs in the browser over the notes already loaded for this notebook,
  // so results update on every keystroke without extra requests.
  const deferredQuery = useDeferredValue(searchQuery)
  const parsedQuery = useMemo(() => parseNoteQuery(deferredQuery), [deferredQuery])
  const isSearching = !isEmptyQuery(parsedQuery)
  const needles = useMemo(
    () => [...parsedQuery.phrases, ...parsedQuery.terms],
    [parsedQuery]
  )
  const search = useMemo(
    () => (isSearching ? searchNotes(notes ?? [], parsedQuery) : null),
    [isSearching, notes, parsedQuery]
  )
  const visibleNotes = useMemo(
    () => (search ? [...search.topHits, ...search.results].map((hit) => hit.note) : notes ?? []),
    [search, notes]
  )
  const clampedActive = Math.min(activeIndex, Math.max(visibleNotes.length - 1, 0))

  const handleDeleteClick = (noteId: string) => {
    setNoteToDelete(noteId)
    setDeleteDialogOpen(true)
  }

  const handleOpenEditor = (note?: NoteResponse) => {
    setEditingNote(note)
    setEditorOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!noteToDelete) return

    try {
      await deleteNote.mutateAsync(noteToDelete)
      setDeleteDialogOpen(false)
      setNoteToDelete(null)
    } catch (error) {
      console.error('Failed to delete note:', error)
    }
  }

  const updateQuery = (value: string) => {
    setSearchQuery(value)
    setActiveIndex(0)
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && searchQuery) {
      event.preventDefault()
      event.stopPropagation()
      updateQuery('')
    } else if (event.key === 'ArrowDown' && isSearching && visibleNotes.length > 0) {
      event.preventDefault()
      setActiveIndex(Math.min(clampedActive + 1, visibleNotes.length - 1))
    } else if (event.key === 'ArrowUp' && isSearching && visibleNotes.length > 0) {
      event.preventDefault()
      setActiveIndex(Math.max(clampedActive - 1, 0))
    } else if (event.key === 'Enter' && isSearching && visibleNotes.length > 0) {
      event.preventDefault()
      handleOpenEditor(visibleNotes[clampedActive])
    }
  }

  const renderNote = (note: NoteResponse, index: number) => {
    const isActive = isSearching && index === clampedActive
    const showExcerpt = isSearching && hasTextCriteria(parsedQuery)
    return (
      <div
        key={note.id}
        id={`note-result-${index}`}
        role={isSearching ? 'option' : undefined}
        aria-selected={isSearching ? isActive : undefined}
        className={cn(
          'p-3 border rounded-md bg-card shadow-none card-hover group relative cursor-pointer',
          isActive && 'ring-2 ring-ring'
        )}
        onClick={() => handleOpenEditor(note)}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {note.note_type === 'ai' ? (
              <Bot className="h-4 w-4 text-teal" />
            ) : (
              <User className="h-4 w-4 text-muted-foreground" />
            )}
            <Badge variant="secondary" className="text-xs">
              {note.note_type === 'ai' ? t('common.aiGenerated') : t('common.human')}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(note.updated), {
                addSuffix: true,
                locale: getDateLocale(language)
              })}
            </span>

            {/* Context toggle - only show if handler provided */}
            {onContextModeChange && contextSelections?.[note.id] && (
              <div onClick={(event) => event.stopPropagation()}>
                <ContextToggle
                  mode={contextSelections[note.id]}
                  hasInsights={false}
                  onChange={(mode) => onContextModeChange(note.id, mode)}
                />
              </div>
            )}

            {/* Ellipsis menu for delete action */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteClick(note.id)
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('notebooks.deleteNote')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {note.title && (
          <h4 className="text-sm font-medium mb-2 wrap-anywhere">
            <HighlightedText text={note.title} needles={needles} />
          </h4>
        )}

        {note.content && (
          <p className="text-sm text-muted-foreground line-clamp-3 wrap-anywhere">
            {showExcerpt ? (
              <HighlightedText text={excerpt(note.content, needles)} needles={needles} />
            ) : (
              note.content
            )}
          </p>
        )}
      </div>
    )
  }

  const sectionHeading = (label: string) => (
    <h3 className="pt-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
      {label}
    </h3>
  )

  const renderList = () => {
    if (!search) {
      return <div className="space-y-2">{visibleNotes.map(renderNote)}</div>
    }
    if (search.total === 0) {
      return (
        <EmptyState
          icon={Search}
          title={t('notebooks.noNotesMatch', { query: searchQuery.trim() })}
          description={t('notebooks.noNotesMatchHint')}
        />
      )
    }
    const topCount = search.topHits.length
    return (
      <div className="space-y-2" role="listbox" aria-label={t('notebooks.searchNotesLabel')}>
        {topCount > 0 && sectionHeading(t('notebooks.topHits'))}
        {search.topHits.map((hit, i) => renderNote(hit.note, i))}
        {topCount > 0 && search.results.length > 0 && sectionHeading(notesLabel)}
        {search.results.map((hit, i) => renderNote(hit.note, topCount + i))}
      </div>
    )
  }

  const hasNotes = !!notes && notes.length > 0

  return (
    <>
      <CollapsibleColumn
        isCollapsed={notesCollapsed}
        onToggle={toggleNotes}
        collapsedIcon={StickyNote}
        collapsedLabel={notesLabel}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-gold" />
                {notesLabel}
              </CardTitle>
              <div className="flex items-center gap-2">
                {onBulkContextModeChange && hasNotes && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground" title={t('sources.bulkContext')}>
                        <ListChecks className="h-4 w-4" />
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('include')}>
                        {t('sources.includeAllInContext')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('exclude')}>
                        {t('sources.excludeAllFromContext')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button size="sm" onClick={() => handleOpenEditor()}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('common.writeNote')}
                </Button>
                {collapseButton}
              </div>
            </div>

            {hasNotes && (
              <div className="space-y-2">
                <div className="relative">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    ref={searchInputRef}
                    type="search"
                    name="notes-search"
                    value={searchQuery}
                    onChange={(e) => updateQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={t('notebooks.searchNotesPlaceholder')}
                    aria-label={t('notebooks.searchNotesLabel')}
                    aria-activedescendant={
                      isSearching && visibleNotes.length > 0 ? `note-result-${clampedActive}` : undefined
                    }
                    title={t('notebooks.searchSyntaxHint')}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 pl-8 pr-8 text-sm [&::-webkit-search-cancel-button]:hidden"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        updateQuery('')
                        searchInputRef.current?.focus()
                      }}
                      aria-label={t('notebooks.clearSearch')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('notebooks.suggestedSearches')}>
                  {SUGGESTIONS.map(({ token, labelKey }) => {
                    const active = hasToken(searchQuery, token)
                    return (
                      <button
                        key={token}
                        type="button"
                        aria-pressed={active}
                        onClick={() => updateQuery(toggleToken(searchQuery, token))}
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                      >
                        {t(labelKey)}
                      </button>
                    )
                  })}
                </div>
                {search && (
                  <p className="text-xs text-muted-foreground" role="status">
                    {t('notebooks.notesMatchCount', { count: search.total, total: notes.length })}
                  </p>
                )}
              </div>
            )}
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : !hasNotes ? (
              <EmptyState
                icon={StickyNote}
                title={t('notebooks.noNotesYet')}
                description={t('sources.createFirstNote')}
              />
            ) : (
              renderList()
            )}
          </CardContent>
        </Card>
      </CollapsibleColumn>

      <NoteEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) {
            setEditingNote(undefined)
          }
        }}
        notebookId={notebookId}
        note={editingNote}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('notebooks.deleteNote')}
        description={t('notebooks.deleteNoteConfirm')}
        confirmText={t('common.delete')}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteNote.isPending}
        confirmVariant="destructive"
      />
    </>
  )
}
