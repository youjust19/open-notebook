'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/hooks/use-translation'
import { AppShell } from '@/components/layout/AppShell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Search, ChevronDown, AlertCircle, Settings, Save, MessageCircleQuestion } from 'lucide-react'
import { useSearch } from '@/lib/hooks/use-search'
import { useAsk } from '@/lib/hooks/use-ask'
import { useModelDefaults, useModels } from '@/lib/hooks/use-models'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { StreamingResponse } from '@/components/search/StreamingResponse'
import { AdvancedModelsDialog } from '@/components/search/AdvancedModelsDialog'
import { SaveToNotebooksDialog } from '@/components/search/SaveToNotebooksDialog'
import { NotebookScopeSelector } from '@/components/search/NotebookScopeSelector'
import { HighlightedText } from '@/components/common/HighlightedText'
import { excerpt, words } from '@/lib/utils/note-search'
import { cn } from '@/lib/utils'
import type { SearchResult } from '@/lib/types/search'

/** Text search runs as you type once the query has this many characters. */
const LIVE_SEARCH_MIN_CHARS = 2
const LIVE_SEARCH_DELAY_MS = 300
/** Like Apple Notes, the strongest matches are pulled out as Top Hits when there are more than this many. */
const TOP_HIT_COUNT = 3

type ResultKind = 'source' | 'note' | 'insight'
type ResultFilter = 'all' | ResultKind

function resultKind(result: SearchResult): ResultKind {
  const table = result.id.split(':')[0]
  if (table === 'note') return 'note'
  if (table === 'source_insight') return 'insight'
  return 'source'
}

export default function SearchPage() {
  const { t } = useTranslation()
  // URL params
  const searchParams = useSearchParams()
  const urlQuery = searchParams?.get('q') || ''
  const rawMode = searchParams?.get('mode')
  const urlMode = rawMode === 'search' ? 'search' : 'ask'

  // Tab state (controlled)
  const [activeTab, setActiveTab] = useState<'ask' | 'search'>(
    urlMode === 'search' ? 'search' : 'ask'
  )

  // Search state
  const [searchQuery, setSearchQuery] = useState(urlMode === 'search' ? urlQuery : '')
  const [searchType, setSearchType] = useState<'text' | 'vector'>('text')
  const [searchSources, setSearchSources] = useState(true)
  const [searchNotes, setSearchNotes] = useState(true)

  // Notebook scope shared by Ask and Search; empty = whole knowledge base (#574, #87)
  const [scopeNotebookIds, setScopeNotebookIds] = useState<string[]>([])

  // Ask state
  const [askQuestion, setAskQuestion] = useState(urlMode === 'ask' ? urlQuery : '')

  // Advanced models dialog
  const [showAdvancedModels, setShowAdvancedModels] = useState(false)
  const [customModels, setCustomModels] = useState<{
    strategy: string
    answer: string
    finalAnswer: string
  } | null>(null)

  // Save to notebooks dialog
  const [showSaveDialog, setShowSaveDialog] = useState(false)

  // Hooks
  const searchMutation = useSearch()
  const ask = useAsk()
  const { data: modelDefaults, isLoading: modelsLoading } = useModelDefaults()
  const { data: availableModels } = useModels()
  const { openModal } = useModalManager()

  const modelNameById = useMemo(() => {
    if (!availableModels) {
      return new Map<string, string>()
    }
    return new Map(availableModels.map((model) => [model.id, model.name]))
  }, [availableModels])

  const resolveModelName = (id?: string | null) => {
    if (!id) return t('searchPage.notSet')
    return modelNameById.get(id) ?? id
  }

  const hasEmbeddingModel = !!modelDefaults?.default_embedding_model

  // Track if we've already auto-triggered from URL params
  const hasAutoTriggeredRef = useRef(false)
  const lastUrlParamsRef = useRef({ q: '', mode: '' })

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return

    searchMutation.mutate({
      query: searchQuery,
      type: searchType,
      limit: 100,
      search_sources: searchSources,
      search_notes: searchNotes,
      minimum_score: 0.2,
      ...(scopeNotebookIds.length > 0 ? { notebook_ids: scopeNotebookIds } : {})
    })
  }, [searchQuery, searchType, searchSources, searchNotes, scopeNotebookIds, searchMutation])

  // Results filter (client-side) and keyboard navigation
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const resultsRef = useRef<HTMLDivElement>(null)

  // Search as you type (text search only: vector search calls the embedding model on every request).
  const latestSearchRef = useRef(handleSearch)
  useEffect(() => {
    latestSearchRef.current = handleSearch
  })
  useEffect(() => {
    if (searchType !== 'text' || searchQuery.trim().length < LIVE_SEARCH_MIN_CHARS) return
    const timer = setTimeout(() => latestSearchRef.current(), LIVE_SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchQuery, searchType, searchSources, searchNotes, scopeNotebookIds])

  const focusResult = (index: number) => {
    const buttons = resultsRef.current?.querySelectorAll<HTMLButtonElement>('[data-result-link]')
    if (!buttons || buttons.length === 0) return
    buttons[Math.max(0, Math.min(index, buttons.length - 1))].focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusResult(0)
    } else if (e.key === 'Escape' && searchQuery) {
      e.preventDefault()
      setSearchQuery('')
    }
  }

  const handleResultsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const buttons = Array.from(
      resultsRef.current?.querySelectorAll<HTMLButtonElement>('[data-result-link]') ?? []
    )
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (current === -1) return
    e.preventDefault()
    if (e.key === 'ArrowUp' && current === 0) {
      document.getElementById('search-query')?.focus()
      return
    }
    focusResult(current + (e.key === 'ArrowDown' ? 1 : -1))
  }

  // Highlight against the query that produced the results, not the one being typed.
  const submittedQuery = searchMutation.variables?.query ?? ''
  // The backend matches each word, so highlight each word (date words are not filters here).
  const needles = useMemo(() => words(submittedQuery), [submittedQuery])

  const allResults = useMemo(() => searchMutation.data?.results ?? [], [searchMutation.data])
  const kindCounts = useMemo(() => {
    const counts: Record<ResultKind, number> = { source: 0, note: 0, insight: 0 }
    for (const result of allResults) counts[resultKind(result)]++
    return counts
  }, [allResults])
  const filterOptions = useMemo(
    () =>
      ([
        ['all', 'searchPage.filterAll', allResults.length],
        ['source', 'searchPage.filterSources', kindCounts.source],
        ['note', 'searchPage.filterNotes', kindCounts.note],
        ['insight', 'searchPage.filterInsights', kindCounts.insight],
      ] as const).filter(([value, , count]) => value === 'all' || count > 0),
    [allResults.length, kindCounts]
  )
  const activeFilter: ResultFilter =
    resultFilter === 'all' || kindCounts[resultFilter] > 0 ? resultFilter : 'all'
  const filteredResults = useMemo(
    () => (activeFilter === 'all' ? allResults : allResults.filter((r) => resultKind(r) === activeFilter)),
    [allResults, activeFilter]
  )
  const topHits = filteredResults.length > TOP_HIT_COUNT ? filteredResults.slice(0, TOP_HIT_COUNT) : []
  const otherResults = topHits.length > 0 ? filteredResults.slice(TOP_HIT_COUNT) : filteredResults

  const renderResult = (result: SearchResult) => {
    const [type, id] = result.id.split(':')
    const modalType = type === 'source_insight' ? 'insight' : type as 'source' | 'note' | 'insight'
    const kind = resultKind(result)
    const matches = (result.matches ?? []).filter((match) => typeof match === 'string' && match.trim())
    const kindLabel =
      kind === 'note' ? t('common.note') : kind === 'insight' ? t('common.insight') : t('common.source')

    return (
      <Card key={result.id} className="transition-shadow hover:shadow-lift">
        <CardContent className="pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <button
                type="button"
                data-result-link
                onClick={() => openModal(modalType, id)}
                className="text-primary hover:underline font-medium text-left break-words"
              >
                <HighlightedText text={result.title} needles={needles} />
              </button>
              <Badge variant="outline" className="ml-2 text-[11px]">
                {kindLabel}
              </Badge>
              <Badge variant="secondary" className="ml-2 font-mono text-[11px]">
                {result.final_score.toFixed(2)}
              </Badge>
            </div>
          </div>

          {matches.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground break-words">
              <HighlightedText text={excerpt(matches[0], needles)} needles={needles} />
            </p>
          )}

          {matches.length > 1 && (
            <Collapsible className="mt-3">
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <ChevronDown className="h-4 w-4" />
                {t('searchPage.matches', { count: matches.length })}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-1">
                {matches.map((match, i) => (
                  <div key={i} className="text-sm pl-6 py-1 border-l-2 border-muted break-words">
                    <HighlightedText text={excerpt(match, needles, 160)} needles={needles} />
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    )
  }

  const handleAsk = useCallback(() => {
    if (!askQuestion.trim() || !modelDefaults?.default_chat_model) return

    const models = customModels || {
      strategy: modelDefaults.default_chat_model,
      answer: modelDefaults.default_chat_model,
      finalAnswer: modelDefaults.default_chat_model
    }

    ask.sendAsk(askQuestion, models, { notebookIds: scopeNotebookIds })
  }, [askQuestion, modelDefaults, customModels, scopeNotebookIds, ask])

  // Auto-trigger search/ask when arriving with URL params
  useEffect(() => {
    // Skip if already triggered or no query
    if (hasAutoTriggeredRef.current || !urlQuery) return

    // Wait for models to load before triggering ask
    if (urlMode === 'ask' && modelsLoading) return

    if (urlMode === 'search') {
      handleSearch()
      hasAutoTriggeredRef.current = true
    } else if (urlMode === 'ask' && modelDefaults?.default_chat_model) {
      handleAsk()
      hasAutoTriggeredRef.current = true
    }
  }, [urlQuery, urlMode, modelsLoading, modelDefaults, handleSearch, handleAsk])

  // Handle URL param changes while on page (e.g., from command palette again)
  useEffect(() => {
    const currentQ = searchParams?.get('q') || ''
    const rawCurrentMode = searchParams?.get('mode')
    const currentMode = rawCurrentMode === 'search' ? 'search' : 'ask'

    // Check if URL params have changed
    if (currentQ !== lastUrlParamsRef.current.q || currentMode !== lastUrlParamsRef.current.mode) {
      lastUrlParamsRef.current = { q: currentQ, mode: currentMode }

      if (currentQ) {
        // Update state based on mode
        if (currentMode === 'search') {
          setSearchQuery(currentQ)
          setActiveTab('search')
          // Reset trigger flag so we auto-trigger with new params
          hasAutoTriggeredRef.current = false
        } else {
          setAskQuestion(currentQ)
          setActiveTab('ask')
          hasAutoTriggeredRef.current = false
        }
      }
    }
  }, [searchParams])

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <h1 className="font-display text-xl md:text-2xl font-bold tracking-tight mb-4 md:mb-6">{t('searchPage.askAndSearch')}</h1>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'ask' | 'search')} className="w-full space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('searchPage.chooseAMode')}</p>
            <TabsList aria-label={t('common.accessibility.searchKB')} className="w-full max-w-xl">
              <TabsTrigger value="ask">
                <MessageCircleQuestion className="h-4 w-4" />
                {t('searchPage.askBeta')}
              </TabsTrigger>
              <TabsTrigger value="search">
                <Search className="h-4 w-4" />
                {t('searchPage.search')}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="ask" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('searchPage.askYourKb')}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t('searchPage.askYourKbDesc')}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Question Input */}
                <div className="space-y-2">
                  <Label htmlFor="ask-question">{t('searchPage.question')}</Label>
                  <Textarea
                    id="ask-question"
                    name="ask-question"
                    placeholder={t('searchPage.enterQuestionPlaceholder')}
                    value={askQuestion}
                    onChange={(e) => setAskQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      // Submit on Cmd/Ctrl+Enter
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !ask.isStreaming && askQuestion.trim()) {
                        e.preventDefault()
                        handleAsk()
                      }
                    }}
                    disabled={ask.isStreaming}
                    rows={3}
                    aria-label={t('common.accessibility.enterQuestion')}
                  />
                  <p className="text-xs text-muted-foreground">{t('searchPage.pressToSubmit')}</p>
                </div>

                {/* Notebook scope */}
                <NotebookScopeSelector
                  selectedIds={scopeNotebookIds}
                  onChange={setScopeNotebookIds}
                  disabled={ask.isStreaming}
                />

                {/* Models Display */}
                {!hasEmbeddingModel ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-warn bg-warn-tint rounded-md">
                    <AlertCircle className="h-4 w-4" />
                    <span>{t('searchPage.noEmbeddingModel')}</span>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">
                          {customModels ? t('searchPage.usingCustomModels') : t('searchPage.usingDefaultModels')}
                        </Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAdvancedModels(true)}
                          disabled={ask.isStreaming}
                          className="h-auto py-1 px-2"
                        >
                          <Settings className="h-3 w-3 mr-1" />
                          {t('searchPage.advanced')}
                        </Button>
                      </div>
                      <div className="flex gap-2 text-xs flex-wrap">
                        <Badge variant="secondary" className="font-mono text-[11px]">
                          {t('searchPage.strategy')}: {resolveModelName(customModels?.strategy || modelDefaults?.default_chat_model)}
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-[11px]">
                          {t('searchPage.answer')}: {resolveModelName(customModels?.answer || modelDefaults?.default_chat_model)}
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-[11px]">
                          {t('searchPage.final')}: {resolveModelName(customModels?.finalAnswer || modelDefaults?.default_chat_model)}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        onClick={handleAsk}
                        disabled={ask.isStreaming || !askQuestion.trim()}
                        className="w-full"
                      >
                        {ask.isStreaming ? (
                          <>
                            <LoadingSpinner size="sm" className="mr-2" />
                            {t('searchPage.processing')}
                          </>
                        ) : (
                          t('searchPage.ask')
                        )}
                      </Button>

                      {ask.finalAnswer && (
                        <Button
                          variant="outline"
                          onClick={() => setShowSaveDialog(true)}
                          className="w-full"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {t('searchPage.saveToNotebooks')}
                        </Button>
                      )}
                    </div>
                  </>
                )}

                {/* Streaming Response */}
                <StreamingResponse
                  isStreaming={ask.isStreaming}
                  strategy={ask.strategy}
                  answers={ask.answers}
                  finalAnswer={ask.finalAnswer}
                />

                {/* Advanced Models Dialog */}
                <AdvancedModelsDialog
                  open={showAdvancedModels}
                  onOpenChange={setShowAdvancedModels}
                  defaultModels={{
                    strategy: customModels?.strategy || modelDefaults?.default_chat_model || '',
                    answer: customModels?.answer || modelDefaults?.default_chat_model || '',
                    finalAnswer: customModels?.finalAnswer || modelDefaults?.default_chat_model || ''
                  }}
                  onSave={setCustomModels}
                />

                {/* Save to Notebooks Dialog */}
                {ask.finalAnswer && (
                  <SaveToNotebooksDialog
                    open={showSaveDialog}
                    onOpenChange={setShowSaveDialog}
                    question={askQuestion}
                    answer={ask.finalAnswer}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="search" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('searchPage.search')}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t('searchPage.searchDesc')}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Search Input */}
                <div className="space-y-2">
                  <Label htmlFor="search-query" className="sr-only">
                    {t('searchPage.search')}
                  </Label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      id="search-query"
                      name="search-query"
                      placeholder={t('searchPage.enterSearchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1"
                      aria-label={t('common.accessibility.enterSearch')}
                      autoComplete="off"
                    />
                    <Button
                      onClick={handleSearch}
                      disabled={searchMutation.isPending || !searchQuery.trim()}
                      aria-label={t('common.accessibility.searchKBBtn')}
                      className="w-full sm:w-auto"
                    >
                      {searchMutation.isPending ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Search className="h-4 w-4 mr-2" />
                      )}
                      {t('searchPage.search')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {searchType === 'text' ? t('searchPage.resultsAsYouType') : t('searchPage.pressToSearch')}
                  </p>
                  {searchType === 'vector' ? (
                    <p className="text-xs text-muted-foreground">{t('searchPage.searchCoverageVector')}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('searchPage.searchCoverageText')}</p>
                  )}
                </div>

                {/* Search Options */}
                <div className="space-y-4">
                  {/* Notebook scope */}
                  <NotebookScopeSelector
                    selectedIds={scopeNotebookIds}
                    onChange={setScopeNotebookIds}
                    disabled={searchMutation.isPending}
                  />

                  {/* Search Type */}
                  <div className="space-y-2" role="group" aria-labelledby="search-type-label">
                    <span id="search-type-label" className="text-sm font-medium leading-none">{t('searchPage.searchType')}</span>
                    {!hasEmbeddingModel && (
                      <div className="flex items-center gap-2 text-sm text-warn">
                        <AlertCircle className="h-4 w-4" />
                        <span>{t('searchPage.vectorSearchWarning')}</span>
                      </div>
                    )}
                    <RadioGroup
                      name="search-type"
                      value={searchType}
                      onValueChange={(value: 'text' | 'vector') => setSearchType(value)}
                      disabled={modelsLoading || searchMutation.isPending}
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="text" id="text" />
                        <Label htmlFor="text" className="font-normal cursor-pointer">
                          {t('searchPage.textSearch')}
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem
                          value="vector"
                          id="vector"
                          disabled={!hasEmbeddingModel || searchMutation.isPending}
                        />
                        <Label
                          htmlFor="vector"
                          className={`font-normal ${!hasEmbeddingModel ? 'text-muted-foreground cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {t('searchPage.vectorSearch')}
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Search Locations */}
                  <div className="space-y-2" role="group" aria-labelledby="search-in-label">
                    <span id="search-in-label" className="text-sm font-medium leading-none">{t('searchPage.searchIn')}</span>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="sources"
                          name="sources"
                          checked={searchSources}
                          onCheckedChange={(checked) => setSearchSources(checked as boolean)}
                          disabled={searchMutation.isPending}
                        />
                        <Label htmlFor="sources" className="font-normal cursor-pointer">
                          {t('searchPage.searchSources')}
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="notes"
                          name="notes"
                          checked={searchNotes}
                          onCheckedChange={(checked) => setSearchNotes(checked as boolean)}
                          disabled={searchMutation.isPending}
                        />
                        <Label htmlFor="notes" className="font-normal cursor-pointer">
                          {t('searchPage.searchNotes')}
                        </Label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Search Results */}
                {searchMutation.data && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">
                        {t('searchPage.resultsFound', { count: searchMutation.data.total_count })}
                      </h3>
                      <Badge variant="outline">{searchMutation.data.search_type === 'text' ? t('searchPage.textSearch') : t('searchPage.vectorSearch')}</Badge>
                    </div>

                    {searchMutation.data.results.length === 0 ? (
                      <Card>
                        <CardContent className="pt-6 text-center text-muted-foreground">
                          {t('searchPage.noResultsFor', { query: submittedQuery })}
                        </CardContent>
                      </Card>
                    ) : (
                      <>
                        {filterOptions.length > 2 && (
                          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('searchPage.filterResultsLabel')}>
                            {filterOptions.map(([value, labelKey, count]) => (
                              <button
                                key={value}
                                type="button"
                                aria-pressed={activeFilter === value}
                                onClick={() => setResultFilter(value)}
                                className={cn(
                                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                                  activeFilter === value
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                )}
                              >
                                {t(labelKey)} · {count}
                              </button>
                            ))}
                          </div>
                        )}

                        <div ref={resultsRef} onKeyDown={handleResultsKeyDown} className="space-y-2">
                          {topHits.length > 0 && (
                            <h4 className="pt-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                              {t('searchPage.topHits')}
                            </h4>
                          )}
                          {topHits.map((result) => renderResult(result))}
                          {topHits.length > 0 && otherResults.length > 0 && (
                            <h4 className="pt-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                              {t('searchPage.moreResults')}
                            </h4>
                          )}
                          {otherResults.map((result) => renderResult(result))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  )
}
