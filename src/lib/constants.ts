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
  SCROLL_BOTTOM_THRESHOLD: 20,
  SCROLL_TOP_THRESHOLD: 10,
  SCROLL_DIFF_THRESHOLD: 5,
  SCROLL_POSITION_THRESHOLD: 60,
  SCROLL_DIFF_UPWARD_THRESHOLD: -10,
  SCROLL_DIFF_FAST_UPWARD_THRESHOLD: -30,
  MESSAGE_MAX_WIDTH_PERCENT: 85,
  MESSAGE_MAX_WIDTH_MOBILE: '85%',
  MESSAGE_MAX_WIDTH_DESKTOP: '75%',
  GRADIENT_MASK_CUTOFF: 95,
  BOTTOM_SPACING: 40,
  BOTTOM_PADDING: 4,
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
  // Animations
  DEBOUNCE: 300,
  ANIMATION_FAST: 150,
  ANIMATION_NORMAL: 200,
  ANIMATION_SLOW: 300,
  ANIMATION_VERY_SLOW: 500,
  ANIMATION_SIDEBAR: 300,

  // UI Interactions
  TYPING_INDICATOR_DELAY: 800,
  TYPING_INDICATOR_CYCLE_MS: 4000,
  AUTO_SCROLL_DELAY: 100,
  AUTO_SCROLL_RESET: 1000,
  NOTIFICATION_AUTO_HIDE: 5000,
  TOOL_FEEDBACK_DELAY: 800,
  SUGGESTION_SHOW_DELAY: 50,
  FOCUS_DELAY: 50,
  FOCUS_IMMEDIATE: 0,

  // Stagger Delays
  SKELETON_STAGGER_DELAY: 100,
  NOTIFICATION_STAGGER_DELAY: 50,
  SUGGESTION_STAGGER_DELAY: 150,

  // Success/Error Messages
  SUCCESS_MESSAGE_DURATION: 3000,
  SETTINGS_SAVE_DELAY: 800,
  MARK_READ_DELAY: 200,

  // Session & Auth (milliseconds)
  SESSION_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
  COOKIE_CACHE_MAX_AGE_MS: 5 * 60 * 1000, // 5 minutes

  // Rate Limiting
  RATE_LIMIT_CLEANUP_INTERVAL: 5 * 60 * 1000, // 5 minutes
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
} as const

// === API Configuration ===
export const API = {
  SUGGESTION_SLICE_LENGTH: 500,
  MAX_SUGGESTIONS: 5,
  RETRY_ATTEMPTS: 2,
  REQUEST_TIMEOUT: 30000,
  MAX_DURATION_SECONDS: 60,
  CHAT_ENDPOINT: '/api/chat',
} as const

// === Limits ===
export const LIMITS = {
  // Content Limits
  MAX_MESSAGE_LENGTH: 10000,
  MAX_LEAD_NOTES_LENGTH: 5000,
  MAX_TAGS_PER_LEAD: 10,
  MAX_CHAT_HISTORY: 100,
  MESSAGE_PREVIEW_LENGTH: 100,
  DEFAULT_MESSAGE_LIMIT: 50,
  CONVERSATION_LIMIT: 20,

  // Password Constraints
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,

  // Chat Input Validation
  MAX_MESSAGES_PER_REQUEST: 200,
  HISTORY_PAGE_SIZE: 50,

  // Search & Pagination
  MAX_SEARCH_RESULTS: 20,
  MAX_SLUG_LENGTH: 30,
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
  CHAT_STATE: 'reme-chat-state',
} as const

// === Z-Index Layers ===
export const Z_INDEX = {
  BASE: 10,
  OVERLAY: 20,
  HEADER: 30,
  SIDEBAR: 40,
  DROPDOWN: 50,
  MODAL: 60,
  TOAST: 70,
  TOOLTIP: 80,
} as const

// === HTTP Status Codes ===
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

// === Rate Limiting ===
export const RATE_LIMIT = {
  MAX_REQUESTS_PER_WINDOW: 100,
  WINDOW_SECONDS: 60,
  AUTH_MAX_REQUESTS: 30,
  AUTH_WINDOW_SECONDS: 60,
} as const

// === Session & Auth (seconds) ===
export const SESSION = {
  EXPIRY_DAYS: 7,
  EXPIRY_SECONDS: 60 * 60 * 24 * 7, // 7 days
  REFRESH_HOURS: 24,
  COOKIE_CACHE_MAX_AGE_SECONDS: 5 * 60, // 5 minutes
} as const

// === Validation ===
export const VALIDATION = {
  MIN_CONVEX_ID_LENGTH: 10,
} as const

// === Monitoring ===
export const MONITORING = {
  MAX_METRICS_STORE: 1000,
} as const
