import { useMemo } from 'react'
import { highlightSegments } from '@/lib/utils/note-search'

interface HighlightedTextProps {
  text: string | null | undefined
  /** Folded words or phrases to mark; see `highlightNeedles`. */
  needles: readonly string[]
}

/**
 * Renders text with search matches wrapped in <mark>, case- and accent-insensitively.
 * Text is rendered as React children, never as HTML, so note content cannot inject markup.
 * Uses the `--best-match` evidence wash, the token the design reference uses for matches.
 */
export function HighlightedText({ text, needles }: HighlightedTextProps) {
  const segments = useMemo(() => highlightSegments(text ?? '', needles), [text, needles])
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark
            key={i}
            className="rounded-[2px] bg-[var(--best-match)] text-inherit"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  )
}
