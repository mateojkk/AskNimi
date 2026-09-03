import { useMemo } from 'react'
import { marked } from 'marked'

interface Props {
  content: string
  className?: string
}

// Configure marked with GitHub-flavored markdown and line breaks
marked.setOptions({
  breaks: true,
  gfm: true,
})

export function Markdown({ content, className }: Props) {
  const html = useMemo(() => {
    try {
      return marked.parse(content, { async: false }) as string
    }
    catch {
      return content
    }
  }, [content])

  return (
    <div
      className={className ? `markdown-body ${className}` : 'markdown-body'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
