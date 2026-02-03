'use client'

import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

// ============================================
// FORM INPUT
// ============================================

export interface FormInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string
  error?: string
  onChange?: (value: string) => void
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, id, className, onChange, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block font-medium text-gray-300 text-sm">
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-xl border border-border bg-surface-elevated px-4 py-3',
            'text-gray-100 placeholder-gray-600 transition-all',
            'focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/20',
            error && 'border-red-500/50 focus:border-red-500/50 focus:ring-red-500/20',
            className
          )}
          onChange={(e) => onChange?.(e.target.value)}
          {...props}
        />
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    )
  }
)

FormInput.displayName = 'FormInput'

// ============================================
// FORM TEXTAREA
// ============================================

export interface FormTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  label: string
  error?: string
  onChange?: (value: string) => void
}

export const FormTextarea = forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ label, error, id, className, onChange, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block font-medium text-gray-300 text-sm">
          {label}
        </label>
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-xl border border-border bg-surface-elevated px-4 py-3',
            'text-gray-100 placeholder-gray-600 transition-all resize-none',
            'focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/20',
            error && 'border-red-500/50 focus:border-red-500/50 focus:ring-red-500/20',
            className
          )}
          onChange={(e) => onChange?.(e.target.value)}
          {...props}
        />
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    )
  }
)

FormTextarea.displayName = 'FormTextarea'

// ============================================
// FORM ERROR MESSAGE
// ============================================

interface FormErrorProps {
  message?: string | null
}

export function FormError({ message }: FormErrorProps) {
  if (!message) return null

  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-red-400 text-sm">
      {message}
    </div>
  )
}

// ============================================
// FORM SUCCESS MESSAGE
// ============================================

interface FormSuccessProps {
  message?: string | null
}

export function FormSuccess({ message }: FormSuccessProps) {
  if (!message) return null

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-400 text-sm">
      {message}
    </div>
  )
}

// ============================================
// FORM FIELD WRAPPER
// ============================================

interface FormFieldProps {
  children: React.ReactNode
  className?: string
}

export function FormField({ children, className }: FormFieldProps) {
  return <div className={cn('space-y-4', className)}>{children}</div>
}

// ============================================
// AUTH LAYOUT COMPONENTS
// ============================================

interface AuthHeaderProps {
  title: string
  subtitle?: string
  logo?: React.ReactNode
}

export function AuthHeader({ title, subtitle, logo }: AuthHeaderProps) {
  return (
    <div className="mb-8 text-center">
      {logo && <div className="mb-4 flex justify-center">{logo}</div>}
      <h1 className="bg-linear-to-r from-amber-400 to-orange-500 bg-clip-text font-bold text-2xl text-transparent">
        {title}
      </h1>
      {subtitle && <p className="mt-2 text-gray-500">{subtitle}</p>}
    </div>
  )
}

interface AuthContainerProps {
  children: React.ReactNode
}

export function AuthContainer({ children }: AuthContainerProps) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

interface AuthFooterLinkProps {
  text: string
  linkText: string
  href: string
}

export function AuthFooterLink({ text, linkText, href }: AuthFooterLinkProps) {
  return (
    <p className="mt-6 text-center text-gray-500">
      {text}{' '}
      <a href={href} className="font-medium text-amber-500 hover:text-amber-400">
        {linkText}
      </a>
    </p>
  )
}
