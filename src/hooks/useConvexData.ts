'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useMemo } from 'react'
import type {
  Appointment,
  AppointmentDisplay,
  Invoice,
  InvoiceDisplay,
  Lead,
  LeadCreateInput,
  LeadDisplay,
  LeadStats,
  LeadStatus,
} from '@/types'

// ============================================
// LEADS HOOKS
// ============================================

interface UseLeadsOptions {
  organizationId: Id<'organizations'>
  userId: Id<'appUsers'>
  status?: LeadStatus
  limit?: number
}

interface UseLeadsReturn {
  leads: LeadDisplay[]
  isLoading: boolean
  stats: LeadStats | undefined
  createLead: (input: LeadCreateInput) => Promise<Id<'leads'>>
  updateLead: (id: Id<'leads'>, updates: Partial<Lead>) => Promise<void>
  deleteLead: (id: Id<'leads'>) => Promise<void>
}

/**
 * Hook for managing leads
 */
export function useLeads({
  organizationId,
  userId,
  status,
  limit,
}: UseLeadsOptions): UseLeadsReturn {
  const leadsData = useQuery(api.leads.list, { userId, organizationId, status, limit })
  const statsData = useQuery(api.leads.getStats, { userId, organizationId })

  const createMutation = useMutation(api.leads.create)
  const updateMutation = useMutation(api.leads.update)
  const deleteMutation = useMutation(api.leads.remove)

  const leads = useMemo<LeadDisplay[]>(() => {
    if (!leadsData) return []
    return leadsData.map((lead: Lead) => ({
      id: lead._id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      status: lead.status,
      value: lead.value,
      tags: lead.tags,
      notes: lead.notes,
    }))
  }, [leadsData])

  const stats = useMemo<LeadStats | undefined>(() => {
    if (!statsData) return undefined
    return {
      total: statsData.total,
      byStatus: statsData.byStatus as Record<LeadStatus, number>,
      totalValue: statsData.totalValue,
      thisMonth: statsData.thisMonth,
    }
  }, [statsData])

  const createLead = useCallback(
    async (input: LeadCreateInput) => {
      return await createMutation({
        organizationId,
        userId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        notes: input.notes,
        tags: input.tags,
        value: input.value,
      })
    },
    [createMutation, organizationId, userId]
  )

  const updateLead = useCallback(
    async (id: Id<'leads'>, updates: Partial<Lead>) => {
      await updateMutation({
        userId,
        id,
        organizationId,
        status: updates.status,
        phone: updates.phone,
        email: updates.email,
        notes: updates.notes,
        tags: updates.tags,
        value: updates.value,
        lastContact: updates.lastContact,
      })
    },
    [organizationId, updateMutation, userId]
  )

  const deleteLead = useCallback(
    async (id: Id<'leads'>) => {
      await deleteMutation({
        userId,
        id,
        organizationId,
      })
    },
    [deleteMutation, organizationId, userId]
  )

  return {
    leads,
    isLoading: leadsData === undefined,
    stats,
    createLead,
    updateLead,
    deleteLead,
  }
}

// ============================================
// APPOINTMENTS HOOKS
// ============================================

interface UseAppointmentsOptions {
  organizationId: Id<'organizations'>
  startDate?: string
  endDate?: string
}

interface UseAppointmentsReturn {
  appointments: AppointmentDisplay[]
  isLoading: boolean
}

/**
 * Hook for managing appointments
 */
export function useAppointments({
  organizationId,
  startDate,
  endDate,
}: UseAppointmentsOptions): UseAppointmentsReturn {
  const appointmentsData = useQuery(api.appointments.list, {
    organizationId,
    startDate,
    endDate,
  })

  const appointments = useMemo<AppointmentDisplay[]>(() => {
    if (!appointmentsData) return []
    return appointmentsData.map((appt: Appointment) => ({
      id: appt._id,
      title: appt.title || 'Appointment',
      date: appt.date,
      time: appt.time,
      leadName: appt.leadName,
      status: appt.status,
    }))
  }, [appointmentsData])

  return {
    appointments,
    isLoading: appointmentsData === undefined,
  }
}

// ============================================
// INVOICES HOOKS
// ============================================

interface UseInvoicesOptions {
  organizationId: Id<'organizations'>
  status?: 'draft' | 'sent' | 'paid'
  limit?: number
}

interface UseInvoicesReturn {
  invoices: InvoiceDisplay[]
  isLoading: boolean
}

/**
 * Hook for managing invoices
 */
export function useInvoices({
  organizationId,
  status,
  limit,
}: UseInvoicesOptions): UseInvoicesReturn {
  const invoicesData = useQuery(api.invoices.list, {
    organizationId,
    status,
    limit,
  })

  const invoices = useMemo<InvoiceDisplay[]>(() => {
    if (!invoicesData) return []
    return invoicesData.map((invoice: Invoice) => ({
      id: invoice._id,
      leadName: invoice.leadName,
      amount: invoice.amount,
      status: invoice.status,
      dueDate: invoice.dueDate,
    }))
  }, [invoicesData])

  return {
    invoices,
    isLoading: invoicesData === undefined,
  }
}

// ============================================
// LEAD SEARCH HOOK
// ============================================

interface UseLeadSearchOptions {
  organizationId: Id<'organizations'>
  userId: Id<'appUsers'>
  query: string
}

/**
 * Hook for searching leads
 */
export function useLeadSearch({ organizationId, userId, query }: UseLeadSearchOptions) {
  const searchResults = useQuery(
    api.leads.search,
    query.length > 0 ? { userId, organizationId, query } : 'skip'
  )

  const results = useMemo<LeadDisplay[]>(() => {
    if (!searchResults) return []
    return searchResults.map((lead: Lead) => ({
      id: lead._id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      status: lead.status,
      value: lead.value,
      tags: lead.tags,
      notes: lead.notes,
    }))
  }, [searchResults])

  return {
    results,
    isSearching: query.length > 0 && searchResults === undefined,
  }
}
