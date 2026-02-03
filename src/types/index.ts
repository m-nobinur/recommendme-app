import type { Id } from '@convex/_generated/dataModel'

// ============================================
// USER TYPES
// ============================================

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

// ============================================
// ORGANIZATION TYPES
// ============================================

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
}

// ============================================
// LEAD TYPES
// ============================================

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

// ============================================
// APPOINTMENT TYPES
// ============================================

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

// ============================================
// INVOICE TYPES
// ============================================

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

// ============================================
// MESSAGE & CHAT TYPES
// ============================================

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

export type MemoryScope = 'user' | 'organization'
export type MemoryType = 'fact' | 'preference' | 'context' | 'instruction'

export interface Memory {
  _id: Id<'memories'>
  organizationId: Id<'organizations'>
  userId?: Id<'appUsers'>
  scope: MemoryScope
  type: MemoryType
  content: string
  embedding?: number[]
  metadata?: Record<string, unknown>
  source?: string
  externalId?: string
  createdAt: number
  updatedAt: number
}

// ============================================
// NOTIFICATION TYPES
// ============================================

export interface Notification {
  id: string
  title: string
  time: string
  read: boolean
  type?: 'info' | 'success' | 'warning' | 'error'
  link?: string
}
