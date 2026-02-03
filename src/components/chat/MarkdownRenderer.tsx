'use client'

import React, { createContext, memo, useContext } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownRendererProps {
  content: string
  className?: string
}

const ListContext = createContext<{ ordered: boolean; index: number }>({
  ordered: false,
  index: 0,
})

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const ListItem: React.FC<{ children?: React.ReactNode; index: number }> = ({
    children,
    index,
  }) => {
    const { ordered } = useContext(ListContext)

    return (
      <li className="group flex items-start gap-3 py-0.5">
        {ordered ? (
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-linear-to-br from-amber-500/20 to-orange-500/10 font-semibold text-amber-500 text-xs shadow-amber-500/10 shadow-sm">
            {index}
          </span>
        ) : (
          <span className="mt-2.5 shrink-0">
            <span className="block h-1.5 w-1.5 rounded-full bg-linear-to-r from-amber-500 to-orange-500 shadow-amber-500/20 shadow-sm transition-transform duration-200 group-hover:scale-125" />
          </span>
        )}
        <span className="flex-1 text-gray-200/90">{children}</span>
      </li>
    )
  }

  const components: Components = {
    h1: ({ children }) => (
      <h1 className="mt-2 mb-4 bg-linear-to-r from-amber-500 to-orange-500 bg-clip-text font-bold text-2xl text-transparent">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-4 mb-3 border-amber-500/20 border-b pb-2 font-semibold text-amber-500/90 text-xl">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-3 mb-2 font-semibold text-amber-500/80 text-lg">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-2 mb-2 font-medium text-base text-gray-100">{children}</h4>
    ),

    p: ({ children }) => (
      <p className="mb-3 text-gray-200/90 leading-relaxed last:mb-0">{children}</p>
    ),

    strong: ({ children }) => <strong className="font-semibold text-amber-500">{children}</strong>,

    em: ({ children }) => <em className="text-gray-400 italic">{children}</em>,

    ul: ({ children }) => {
      let itemIndex = 0
      return (
        <ListContext.Provider value={{ ordered: false, index: 0 }}>
          <ul className="mt-2 mb-4 space-y-1.5 pl-1">
            {React.Children.map(children, (child) => {
              if (
                React.isValidElement<{ children?: React.ReactNode }>(child) &&
                child.type === 'li'
              ) {
                itemIndex++
                return <ListItem index={itemIndex}>{child.props.children}</ListItem>
              }
              return null
            })}
          </ul>
        </ListContext.Provider>
      )
    },

    ol: ({ children }) => {
      let itemIndex = 0

      return (
        <ListContext.Provider value={{ ordered: true, index: 0 }}>
          <ol className="mt-2 mb-4 space-y-1.5 pl-1">
            {React.Children.map(children, (child) => {
              if (
                React.isValidElement<{ children?: React.ReactNode }>(child) &&
                child.type === 'li'
              ) {
                itemIndex++
                return <ListItem index={itemIndex}>{child.props.children}</ListItem>
              }
              return null
            })}
          </ol>
        </ListContext.Provider>
      )
    },

    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-amber-500 underline decoration-amber-500/30 underline-offset-2 transition-all duration-200 hover:text-amber-400 hover:decoration-amber-500/60"
      >
        {children}
      </a>
    ),

    code: ({ className, children, ...props }) => {
      const isInline = !className

      if (isInline) {
        return (
          <code
            className="rounded-md border border-border-strong bg-surface-muted px-1.5 py-0.5 font-mono text-amber-500 text-sm"
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
          <span className="h-3 w-3 rounded-full bg-red-500/60" />
          <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
          <span className="h-3 w-3 rounded-full bg-green-500/60" />
        </div>
        <div className="font-mono text-gray-400 text-sm leading-relaxed">{children}</div>
      </pre>
    ),

    blockquote: ({ children }) => (
      <blockquote className="mb-4 rounded-r-lg border-l-4 border-l-amber-500/60 bg-linear-to-r from-amber-500/5 to-transparent py-2 pl-4 text-gray-400">
        {children}
      </blockquote>
    ),

    hr: () => (
      <hr className="my-6 h-px border-0 bg-linear-to-r from-transparent via-amber-500/30 to-transparent" />
    ),

    table: ({ children }) => (
      <div className="mt-2 mb-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),

    thead: ({ children }) => (
      <thead className="border-border border-b bg-linear-to-r from-amber-500/10 to-orange-500/5">
        {children}
      </thead>
    ),

    th: ({ children }) => (
      <th className="px-4 py-3 text-left font-semibold text-amber-500/90 text-xs uppercase tracking-wider">
        {children}
      </th>
    ),

    tbody: ({ children }) => <tbody className="divide-y divide-surface-muted">{children}</tbody>,

    tr: ({ children }) => (
      <tr className="transition-colors duration-150 hover:bg-surface-elevated">{children}</tr>
    ),

    td: ({ children }) => <td className="px-4 py-3 text-gray-400">{children}</td>,

    input: ({ type, checked }) => {
      if (type === 'checkbox') {
        return (
          <span
            className={`mr-2 inline-flex h-4 w-4 items-center justify-center rounded border ${
              checked
                ? 'border-amber-500 bg-linear-to-br from-amber-500 to-orange-500'
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
      <del className="text-gray-500 line-through decoration-gray-500/50">{children}</del>
    ),
  }

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownRenderer)
