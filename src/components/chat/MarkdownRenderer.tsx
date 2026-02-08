'use client'

import React, { createContext, memo, useContext } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const ListContext = createContext<{ ordered: boolean }>({ ordered: false })

const REMARK_PLUGINS = [remarkGfm]

function ListItem({ children, index }: { children?: React.ReactNode; index: number }) {
  const { ordered } = useContext(ListContext)

  return (
    <li className="group flex items-start gap-3 py-0.5">
      {ordered ? (
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-linear-to-br from-brand/20 to-brand-secondary/10 font-semibold text-brand text-xs shadow-brand/10 shadow-sm">
          {index}
        </span>
      ) : (
        <span className="mt-2.5 shrink-0">
          <span className="block h-1.5 w-1.5 rounded-full bg-linear-to-r from-brand to-brand-secondary shadow-brand/20 shadow-sm transition-transform duration-200 group-hover:scale-125" />
        </span>
      )}
      <span className="flex-1 text-text-primary/90">{children}</span>
    </li>
  )
}

const ORDERED_CTX = { ordered: true }
const UNORDERED_CTX = { ordered: false }

function StyledList({ children, ordered }: { children?: React.ReactNode; ordered: boolean }) {
  let itemIndex = 0
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <ListContext.Provider value={ordered ? ORDERED_CTX : UNORDERED_CTX}>
      <Tag className="mt-2 mb-4 space-y-1.5 pl-1">
        {React.Children.map(children, (child) => {
          if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === 'li') {
            itemIndex++
            return <ListItem index={itemIndex}>{child.props.children}</ListItem>
          }
          return null
        })}
      </Tag>
    </ListContext.Provider>
  )
}

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-2 mb-4 text-gradient-brand font-bold text-2xl">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-3 border-brand/20 border-b pb-2 font-semibold text-brand/90 text-xl">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-2 font-semibold text-brand/80 text-lg">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-2 font-medium text-base text-text-primary">{children}</h4>
  ),

  p: ({ children }) => (
    <p className="mb-3 text-text-primary/90 leading-relaxed last:mb-0">{children}</p>
  ),

  strong: ({ children }) => <strong className="font-semibold text-brand">{children}</strong>,
  em: ({ children }) => <em className="text-text-secondary italic">{children}</em>,

  ul: ({ children }) => <StyledList ordered={false}>{children}</StyledList>,
  ol: ({ children }) => <StyledList ordered={true}>{children}</StyledList>,

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline decoration-brand/30 underline-offset-2 transition-all duration-200 hover:text-brand-accent hover:decoration-brand/60"
    >
      {children}
    </a>
  ),

  code: ({ className, children, ...props }) => {
    if (!className) {
      return (
        <code
          className="rounded-md border border-border-strong bg-surface-muted px-1.5 py-0.5 font-mono text-brand text-sm"
          {...props}
        >
          {children}
        </code>
      )
    }

    return (
      <code className={`block ${className}`} {...props}>
        {children}
      </code>
    )
  },

  pre: ({ children }) => (
    <pre className="mt-2 mb-4 overflow-x-auto rounded-xl border border-border bg-surface-tertiary p-4">
      <div className="mb-3 flex items-center gap-1.5 border-border border-b pb-2">
        <span className="h-3 w-3 rounded-full bg-status-error/60" />
        <span className="h-3 w-3 rounded-full bg-status-warning/60" />
        <span className="h-3 w-3 rounded-full bg-status-success/60" />
      </div>
      <div className="font-mono text-text-secondary text-sm leading-relaxed">{children}</div>
    </pre>
  ),

  blockquote: ({ children }) => (
    <blockquote className="mb-4 rounded-r-lg border-l-4 border-l-brand/60 bg-linear-to-r from-brand/5 to-transparent py-2 pl-4 text-text-secondary">
      {children}
    </blockquote>
  ),

  hr: () => (
    <hr className="my-6 h-px border-0 bg-linear-to-r from-transparent via-brand/30 to-transparent" />
  ),

  table: ({ children }) => (
    <div className="mt-2 mb-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),

  thead: ({ children }) => (
    <thead className="border-border border-b bg-linear-to-r from-brand/10 to-brand-secondary/5">
      {children}
    </thead>
  ),

  th: ({ children }) => (
    <th className="px-4 py-3 text-left font-semibold text-brand/90 text-xs uppercase tracking-wider">
      {children}
    </th>
  ),

  tbody: ({ children }) => <tbody className="divide-y divide-surface-muted">{children}</tbody>,

  tr: ({ children }) => (
    <tr className="transition-colors duration-150 hover:bg-surface-elevated">{children}</tr>
  ),

  td: ({ children }) => <td className="px-4 py-3 text-text-secondary">{children}</td>,

  input: ({ type, checked }) => {
    if (type === 'checkbox') {
      return (
        <span
          className={`mr-2 inline-flex h-4 w-4 items-center justify-center rounded border ${
            checked
              ? 'border-brand bg-linear-to-br from-brand to-brand-secondary'
              : 'border-border-strong bg-surface-muted'
          }`}
        >
          {checked && (
            <svg
              className="h-3 w-3 text-black"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      )
    }
    return <input type={type} />
  },

  del: ({ children }) => (
    <del className="text-text-muted line-through decoration-text-muted/50">{children}</del>
  ),
}

interface MarkdownRendererProps {
  content: string
  className?: string
}

function MarkdownRendererComponent({ content, className = '' }: MarkdownRendererProps) {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownRendererComponent)
