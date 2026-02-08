import { Loader2 } from 'lucide-react'
import React from 'react'
import { cn } from '@/lib/utils/cn'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'glass' | 'outline' | 'danger'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  isLoading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:pointer-events-none active:scale-95'

    const variants = {
      primary:
        'bg-brand text-white hover:bg-brand-accent hover:shadow-lg hover:shadow-brand/20 border border-transparent',
      secondary:
        'bg-border text-text-primary hover:bg-border-strong hover:text-white border border-border-strong',
      ghost: 'bg-transparent text-text-secondary hover:text-white hover:bg-surface-muted',
      glass:
        'backdrop-blur-md bg-surface-muted/80 border border-border-strong text-text-primary hover:bg-border hover:border-brand/30 hover:shadow-lg hover:shadow-black/50',
      outline:
        'bg-transparent border border-border-strong text-text-primary hover:border-brand/50 hover:text-brand',
      danger:
        'bg-status-error/20 text-status-error border border-status-error/50 hover:bg-status-error/30 hover:border-status-error/50',
    }

    const sizes = {
      sm: 'h-8 px-3 text-xs gap-1.5',
      md: 'h-10 px-4 text-sm gap-2',
      lg: 'h-12 px-6 text-base gap-2.5',
      icon: 'h-10 w-10 p-0',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {leftIcon && <span className="shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'
