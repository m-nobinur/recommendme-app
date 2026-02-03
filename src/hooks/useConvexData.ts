'use client'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useMemo } from 'react'
import type {
  AppointmentDisplay,
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
  status?: LeadStatus
  limit?: number
}

interface UseLeadsReturn {
  leads: LeadDisplay[]
  isLoading: boolean
  stats: LeadStats | undefined
  createLead: (input: LeadCreateInput, userId: Id<'appUsers'>) => Promise<Id<'leads'>>
  updateLead: (id: Id<'leads'>, updates: Partial<Lead>) => Promise<void>
  deleteLead: (id: Id<'leads'>) => Promise<void>
}

/**
 * Hook for managing leads
 */
export function useLeads({ organizationId, status, limit }: UseLeadsOptions): UseLeadsReturn {
  const leadsData = useQuery(api.leads.list, { organizationId, status, limit })
  const statsData = useQuery(api.leads.getStats, { organizationId })

  const createMutation = useMutation(api.leads.create)
  const updateMutation = useMutation(api.leads.update)
  const deleteMutation = useMutation(api.leads.remove)

  const leads = useMemo<LeadDisplay[]>(() => {
    if (!leadsData) return []
    return leadsData.map((lead) => ({
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
    async (input: LeadCreateInput, userId: Id<'appUsers'>) => {
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
    [createMutation, organizationId]
  )

  const updateLead = useCallback(
    async (id: Id<'leads'>, updates: Partial<Lead>) => {
      await updateMutation({
        id,
        status: updates.status,
        phone: updates.phone,
        email: updates.email,
        notes: updates.notes,
        tags: updates.tags,
        value: updates.value,
        lastContact: updates.lastContact,
      })
    },
    [updateMutation]
  )

  const deleteLead = useCallback(
    async (id: Id<'leads'>) => {
      await deleteMutation({ id })
    },
    [deleteMutation]
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
    return appointmentsData.map((appt) => ({
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
    return invoicesData.map((invoice) => ({
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
  query: string
}

/**
 * Hook for searching leads
 */
export function useLeadSearch({ organizationId, query }: UseLeadSearchOptions) {
  const searchResults = useQuery(
    api.leads.search,
    query.length > 0 ? { organizationId, query } : 'skip'
  )

  const results = useMemo<LeadDisplay[]>(() => {
    if (!searchResults) return []
    return searchResults.map((lead) => ({
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
