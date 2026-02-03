import React from 'react'
import { Button, type ButtonProps } from '@/components/ui/Button'
import { cn } from '@/lib/utils/cn'

export interface IconButtonProps extends Omit<ButtonProps, 'leftIcon' | 'rightIcon'> {
  icon: React.ReactNode
  label: string // Accessibility label is required
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, className, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        size="icon"
        className={cn('rounded-full', className)}
        aria-label={label}
        title={label}
        {...props}
      >
        {icon}
      </Button>
    )
  }
)

IconButton.displayName = 'IconButton'
