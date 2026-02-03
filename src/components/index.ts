/**
 * Component Barrel Exports
 * Central export point for all reusable components
 */

// ============================================
// CHAT COMPONENTS
// ============================================
export { default as ChatInput } from './chat/ChatInput'
export { default as MarkdownRenderer } from './chat/MarkdownRenderer'
export { default as MessageBubble } from './chat/MessageBubble'
export { default as TypingIndicator } from './chat/TypingIndicator'

// ============================================
// DASHBOARD COMPONENTS
// ============================================
export { DashboardHeader, DashboardSidebarToggle, DashboardView } from './dashboard'

// ============================================
// ERROR COMPONENTS
// ============================================
export { ErrorBoundary } from './error'

// ============================================
// LAYOUT COMPONENTS
// ============================================
export { default as BrainSwitcher } from './layout/BrainSwitcher'
export { default as NotificationDropdown } from './layout/NotificationDropdown'

// ============================================
// UI COMPONENTS
// ============================================
export { Button } from './ui/Button'
export {
  AuthContainer,
  AuthFooterLink,
  AuthHeader,
  FormError,
  FormField,
  FormInput,
  FormSuccess,
  FormTextarea,
} from './ui/Form'
export { IconButton } from './ui/IconButton'
export { Logo } from './ui/Logo'
export {
  Skeleton,
  SkeletonAuthForm,
  SkeletonAvatar,
  SkeletonButton,
  SkeletonChatHistory,
  SkeletonInput,
  SkeletonMessage,
  SkeletonSettings,
  SkeletonText,
} from './ui/Skeleton'
