/**
 * Application Constants
 * Centralized configuration - NO magic numbers in code
 */

// === UI Dimensions (pixels) ===
export const UI = {
  SIDEBAR_WIDTH: 320,
  HEADER_HEIGHT: 64,
  CHAT_INPUT_MAX_HEIGHT: 120,
  SCROLL_THRESHOLD: 150,
  MESSAGE_MAX_WIDTH_PERCENT: 85,
  TEXTAREA_MIN_ROWS: 1,
  TEXTAREA_MAX_ROWS: 5,
  TAB_PILL_OFFSET: 4,
  TAB_COUNT: 3,
  AVATAR_SIZE_SM: 32,
  AVATAR_SIZE_MD: 40,
  AVATAR_SIZE_LG: 48,
  BORDER_RADIUS_SM: 8,
  BORDER_RADIUS_MD: 12,
  BORDER_RADIUS_LG: 16,
  BORDER_RADIUS_XL: 20,
} as const

// === Timing (milliseconds) ===
export const TIMING = {
  DEBOUNCE: 300,
  ANIMATION_FAST: 150,
  ANIMATION_NORMAL: 200,
  ANIMATION_SLOW: 300,
  ANIMATION_SIDEBAR: 300,
  TYPING_INDICATOR_DELAY: 800,
  AUTO_SCROLL_DELAY: 100,
  AUTO_SCROLL_RESET: 1000,
  NOTIFICATION_AUTO_HIDE: 5000,
  TOOL_FEEDBACK_DELAY: 800,
  SUGGESTION_SHOW_DELAY: 50,
} as const

// === API Configuration ===
export const API = {
  SUGGESTION_SLICE_LENGTH: 500,
  MAX_SUGGESTIONS: 5,
  RETRY_ATTEMPTS: 2,
  REQUEST_TIMEOUT: 30000,
  CHAT_ENDPOINT: '/api/chat',
} as const

// === Limits ===
export const LIMITS = {
  MAX_MESSAGE_LENGTH: 10000,
  MAX_LEAD_NOTES_LENGTH: 5000,
  MAX_TAGS_PER_LEAD: 10,
  MAX_CHAT_HISTORY: 100,
  MIN_PASSWORD_LENGTH: 8,
  MAX_SEARCH_RESULTS: 20,
} as const

// === Routes ===
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  CHAT: '/chat',
  SETTINGS: '/settings',
  API_AUTH: '/api/auth',
  API_CHAT: '/api/chat',
} as const

// === App Info ===
export const APP = {
  NAME: 'Reme',
  FULL_NAME: 'RecommendMe',
  DESCRIPTION: 'AI-powered business assistant',
  URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
} as const

// === Lead Status Configuration ===
export const LEAD_STATUS = {
  VALUES: ['New', 'Contacted', 'Qualified', 'Proposal', 'Booked', 'Closed'] as const,
  COLORS: {
    New: 'blue',
    Contacted: 'yellow',
    Qualified: 'emerald',
    Proposal: 'purple',
    Booked: 'indigo',
    Closed: 'gray',
  } as const,
} as const

// === Appointment Status Configuration ===
export const APPOINTMENT_STATUS = {
  VALUES: ['scheduled', 'completed', 'cancelled'] as const,
} as const

// === Invoice Status Configuration ===
export const INVOICE_STATUS = {
  VALUES: ['draft', 'sent', 'paid'] as const,
  COLORS: {
    draft: 'amber',
    sent: 'blue',
    paid: 'emerald',
  } as const,
} as const

// === Storage Keys ===
export const STORAGE_KEYS = {
  MODEL_CONFIG: 'reme-model-config',
  THEME: 'reme-theme',
  SIDEBAR_STATE: 'reme-sidebar-state',
} as const

// === Z-Index Layers ===
export const Z_INDEX = {
  SIDEBAR: 40,
  HEADER: 30,
  DROPDOWN: 50,
  MODAL: 60,
  TOAST: 70,
  TOOLTIP: 80,
} as const
