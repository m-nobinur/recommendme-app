import type { Id } from '@convex/_generated/dataModel'

export interface User {
  id: string
  email: string
  name?: string | null
  image?: string | null
}

export interface AppUser {
  _id: Id<'appUsers'>
  authUserId: string
  organizationId: Id<'organizations'>
  role: UserRole
  settings?: UserSettings
  createdAt: number
  updatedAt: number
}

export type UserRole = 'owner' | 'admin' | 'member'

export interface UserSettings {
  aiProvider?: string
  modelTier?: string
  theme?: string
}

export interface Organization {
  _id: Id<'organizations'>
  name: string
  slug: string
  createdAt: number
  settings?: OrganizationSettings
}

export interface OrganizationSettings {
  defaultAiProvider?: string
  modelTier?: string
  budgetTier?: 'free' | 'starter' | 'pro' | 'enterprise'
  nicheId?: string
  timezone?: string
}

export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Proposal' | 'Booked' | 'Closed'

export interface Lead {
  _id: Id<'leads'>
  organizationId: Id<'organizations'>
  name: string
  phone?: string
  email?: string
  status: LeadStatus
  notes?: string
  tags: string[]
  value?: number
  createdAt: number
  createdBy: Id<'appUsers'>
  updatedAt: number
  lastContact?: number
}

export interface LeadDisplay {
  id: string
  name: string
  phone?: string
  email?: string
  status: LeadStatus
  value?: number
  tags?: string[]
  notes?: string
}

export interface LeadCreateInput {
  name: string
  phone?: string
  email?: string
  notes?: string
  tags?: string[]
  value?: number
}

export interface LeadUpdateInput {
  status?: LeadStatus
  phone?: string
  email?: string
  notes?: string
  tags?: string[]
  value?: number
  lastContact?: number
}

export interface LeadStats {
  total: number
  byStatus: Record<LeadStatus, number>
  totalValue: number
  thisMonth: number
}

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled'

export interface Appointment {
  _id: Id<'appointments'>
  organizationId: Id<'organizations'>
  leadId: Id<'leads'>
  leadName: string
  date: string
  time: string
  title?: string
  notes?: string
  status: AppointmentStatus
  createdAt: number
  createdBy: Id<'appUsers'>
  updatedAt: number
}

export interface AppointmentDisplay {
  id: string
  title: string
  date: string
  time: string
  leadName: string
  status: AppointmentStatus
}

export interface AppointmentCreateInput {
  leadName: string
  date: string
  time: string
  title?: string
  notes?: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid'

export interface InvoiceItem {
  name: string
  quantity: number
  price: number
}

export interface Invoice {
  _id: Id<'invoices'>
  organizationId: Id<'organizations'>
  leadId: Id<'leads'>
  leadName: string
  amount: number
  status: InvoiceStatus
  description?: string
  items?: InvoiceItem[]
  createdAt: number
  createdBy: Id<'appUsers'>
  updatedAt: number
  dueDate?: string
  paidAt?: number
}

export interface InvoiceDisplay {
  id: string
  leadName: string
  amount: number
  status: InvoiceStatus
}

export interface InvoiceCreateInput {
  leadName: string
  amount: number
  description?: string
  items?: string[]
  dueDate?: string
}

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
}

export interface MessageMetadata {
  model?: string
  provider?: string
  tokenCount?: number
  latencyMs?: number
}

export interface Message {
  _id: Id<'messages'>
  organizationId: Id<'organizations'>
  userId: Id<'appUsers'>
  conversationId: string
  role: MessageRole
  content: string
  toolCalls?: ToolCall[]
  metadata?: MessageMetadata
  createdAt: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content?: string
  parts?: MessagePart[]
  suggestions?: string[]
  createdAt?: Date
}

export interface MessagePart {
  type: 'text' | 'tool-invocation' | 'reasoning' | 'file'
  text?: string
  reasoning?: string
  toolInvocation?: {
    toolName: string
    args: Record<string, unknown>
    result?: unknown
  }
  mediaType?: string
  data?: string
}

// ============================================
// MEMORY TYPES
// ============================================
export type PlatformMemoryCategory =
  | 'sales'
  | 'scheduling'
  | 'pricing'
  | 'communication'
  | 'followup'

export interface PlatformMemory {
  _id: Id<'platformMemories'>
  category: PlatformMemoryCategory
  content: string
  embedding?: number[]
  confidence: number
  sourceCount: number
  validatedAt?: number
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface NicheMemory {
  _id: Id<'nicheMemories'>
  nicheId: string
  category: string
  content: string
  embedding?: number[]
  confidence: number
  contributorCount: number
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type BusinessMemoryType =
  | 'fact'
  | 'preference'
  | 'instruction'
  | 'context'
  | 'relationship'
  | 'episodic'

export type MemorySource = 'extraction' | 'explicit' | 'tool' | 'system'

export interface BusinessMemory {
  _id: Id<'businessMemories'>
  organizationId: Id<'organizations'>
  userId?: string
  type: BusinessMemoryType
  content: string
  embedding?: number[]
  subjectType?: string
  subjectId?: string
  importance: number
  confidence: number
  decayScore: number
  accessCount: number
  lastAccessedAt: number
  source: MemorySource
  sourceMessageId?: string
  expiresAt?: number
  isActive: boolean
  isArchived: boolean
  version: number
  previousVersionId?: Id<'businessMemories'>
  history?: Array<{
    previousContent: string
    changedAt: number
    reason?: string
  }>
  createdAt: number
  updatedAt: number
}

export type AgentMemoryCategory = 'pattern' | 'preference' | 'success' | 'failure'

export interface AgentMemory {
  _id: Id<'agentMemories'>
  organizationId: Id<'organizations'>
  agentType: string
  category: AgentMemoryCategory
  content: string
  embedding?: number[]
  useCount: number
  successRate: number
  confidence: number
  decayScore: number
  lastUsedAt: number
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type MemoryRelationType =
  | 'prefers'
  | 'related_to'
  | 'leads_to'
  | 'requires'
  | 'conflicts_with'

export interface MemoryRelation {
  _id: Id<'memoryRelations'>
  organizationId: Id<'organizations'>
  sourceType: string
  sourceId: string
  targetType: string
  targetId: string
  relationType: MemoryRelationType
  strength: number
  evidence: string
  createdAt: number
  updatedAt: number
}

export type MemoryEventType =
  | 'conversation_end'
  | 'tool_success'
  | 'tool_failure'
  | 'user_correction'
  | 'explicit_instruction'
  | 'approval_granted'
  | 'approval_rejected'
  | 'feedback'

export type MemoryEventSourceType = 'message' | 'tool_call' | 'agent_action'

export interface MemoryEvent {
  _id: Id<'memoryEvents'>
  organizationId: Id<'organizations'>
  eventType: MemoryEventType
  sourceType: MemoryEventSourceType
  sourceId: string
  data: unknown
  processed: boolean
  processedAt?: number
  createdAt: number
}

// ============================================
// AGENT FRAMEWORK TYPES
// ============================================

export type { AgentConfig, AgentHandler } from '@/lib/ai/agents/core'
export type {
  ActionResult,
  AgentAction,
  AgentContext,
  AgentPlan,
  AgentType,
  ExecutionStatus,
  ExecutionSummary,
  MemoryLayer,
  PlanPrompt,
  RiskAssessment,
  RiskLevel,
  TriggerType,
} from '@/lib/ai/agents/core/types'
export {
  AGENT_TYPES,
  EXECUTION_STATUSES,
  MEMORY_LAYERS,
  RISK_LEVELS,
  TRIGGER_TYPES,
} from '@/lib/ai/agents/core/types'

export interface Notification {
  id: string
  title: string
  time: string
  read: boolean
  type?: 'info' | 'success' | 'warning' | 'error'
  link?: string
}
