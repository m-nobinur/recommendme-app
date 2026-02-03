'use client'

import { Calendar, ChevronLeft, FileText, LogOut, Mail, Phone, Settings, Users } from 'lucide-react'
import Link from 'next/link'
import { memo, useState } from 'react'
// Direct imports instead of barrel (bundle-barrel-imports)
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import type { AppointmentDisplay, InvoiceDisplay, LeadDisplay, LeadStatus, User } from '@/types'

// ============================================
// TYPES
// ============================================

type DashboardTab = 'leads' | 'schedule' | 'invoices'
type SlideDirection = 'left' | 'right'

interface DashboardViewProps {
  user: User
  leads: LeadDisplay[]
  appointments: AppointmentDisplay[]
  invoices: InvoiceDisplay[]
  onSignOut: () => void
  isSigningOut: boolean
}

// ============================================
// STATUS COLORS
// ============================================

const STATUS_COLORS: Record<LeadStatus, string> = {
  New: 'bg-blue-500',
  Contacted: 'bg-yellow-500',
  Qualified: 'bg-emerald-500',
  Proposal: 'bg-purple-500',
  Booked: 'bg-indigo-500',
  Closed: 'bg-gray-600',
}

const STATUS_TEXT_COLORS: Record<LeadStatus, string> = {
  New: 'text-blue-500',
  Contacted: 'text-yellow-500',
  Qualified: 'text-emerald-500',
  Proposal: 'text-purple-500',
  Booked: 'text-indigo-500',
  Closed: 'text-gray-300',
}

// ============================================
// LEAD DETAIL VIEW
// ============================================

interface LeadDetailProps {
  lead: LeadDisplay
  onBack: () => void
}

function LeadDetail({ lead, onBack }: LeadDetailProps) {
  return (
    <div className="h-full flex flex-col bg-surface-secondary animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b border-border flex items-center gap-3">
        <IconButton
          onClick={onBack}
          icon={<ChevronLeft className="w-4.5 h-4.5" />}
          variant="ghost"
          size="sm"
          label="Back to leads"
        />
        <h2 className="font-semibold text-gray-200">Lead Details</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-900/50 to-amber-700/20 border border-amber-900/50 flex items-center justify-center text-amber-500 text-lg font-bold">
            {lead.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-white truncate">{lead.name}</h3>
            <div className="flex flex-col gap-1 mt-1">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Phone className="w-3.5 h-3.5" />
                {lead.phone || 'No phone'}
              </div>
              {lead.email && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Mail className="w-3.5 h-3.5" />
                  <span className="truncate">{lead.email}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-surface-elevated border border-border">
            <span className="text-[10px] uppercase text-gray-600 font-bold tracking-wider">
              Status
            </span>
            <div className={`mt-1 text-sm font-medium ${STATUS_TEXT_COLORS[lead.status]}`}>
              {lead.status}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-surface-elevated border border-border">
            <span className="text-[10px] uppercase text-gray-600 font-bold tracking-wider">
              Est. Value
            </span>
            <div className="mt-1 text-sm font-medium text-amber-500">
              {lead.value ? `$${lead.value}` : '—'}
            </div>
          </div>
        </div>

        {lead.tags && lead.tags.length > 0 && (
          <div>
            <span className="text-xs text-gray-500 mb-2 block">Tags</span>
            <div className="flex flex-wrap gap-2">
              {lead.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 rounded bg-surface-muted border border-border-strong text-[10px] text-gray-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className="text-xs text-gray-500 mb-2 block">Notes</span>
          <div className="p-3 rounded-lg bg-surface-elevated border border-border text-sm text-gray-300 leading-relaxed min-h-[100px] whitespace-pre-wrap">
            {lead.notes || 'No notes available.'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// TAB CONTENT COMPONENTS (Memoized for performance)
// ============================================

interface LeadsTabProps {
  leads: LeadDisplay[]
  direction: SlideDirection
  onSelectLead: (lead: LeadDisplay) => void
}

// Memoized LeadsTab component (rerender-memo)
const LeadsTab = memo(function LeadsTab({ leads, direction, onSelectLead }: LeadsTabProps) {
  const animationClass = direction === 'right' ? 'animate-slideInRight' : 'animate-slideInLeft'

  return (
    <div className={`space-y-2 ${animationClass}`}>
      {leads.map((lead) => (
        <button
          key={lead.id}
          type="button"
          onClick={() => onSelectLead(lead)}
          className="group flex items-center gap-3 p-3 rounded-xl bg-surface-tertiary border border-transparent hover:border-border hover:bg-[#0f0f0f] transition-all cursor-pointer w-full text-left"
        >
          <div className="w-8 h-8 rounded-full bg-border-subtle flex items-center justify-center text-[10px] font-bold text-gray-500 group-hover:text-amber-500 group-hover:bg-surface-muted transition-colors">
            {lead.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-200 font-medium truncate group-hover:text-white transition-colors">
                {lead.name}
              </span>
              <div className="flex items-center gap-2">
                {lead.value && (
                  <span className="text-[10px] font-mono text-amber-600/80 bg-amber-900/10 px-1.5 rounded">
                    ${lead.value}
                  </span>
                )}
                <div
                  className={`w-1.5 h-1.5 rounded-full ring-2 ring-surface-tertiary ${STATUS_COLORS[lead.status]}`}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-gray-600 truncate max-w-[120px]">
                {lead.notes || lead.phone}
              </span>
              {lead.tags?.slice(0, 1).map((tag) => (
                <span
                  key={tag}
                  className="px-1 py-0.5 rounded-[3px] bg-surface-muted text-[9px] text-gray-500 border border-border"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
})

interface ScheduleTabProps {
  appointments: AppointmentDisplay[]
  direction: SlideDirection
}

// Memoized ScheduleTab component (rerender-memo)
const ScheduleTab = memo(function ScheduleTab({ appointments, direction }: ScheduleTabProps) {
  const animationClass = direction === 'right' ? 'animate-slideInRight' : 'animate-slideInLeft'

  if (appointments.length === 0) {
    return (
      <div className={`pt-8 text-center text-xs text-gray-700 italic ${animationClass}`}>
        Empty calendar
      </div>
    )
  }

  return (
    <div className={`relative ${animationClass}`}>
      <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border-subtle" />
      <div className="space-y-4">
        {appointments.map((appt) => (
          <div key={appt.id} className="relative pl-10 group">
            <div className="absolute left-[15px] top-1.5 w-2.5 h-2.5 rounded-full bg-surface-secondary border border-amber-800 group-hover:bg-amber-900/50 group-hover:border-amber-500 transition-colors z-10" />
            <div className="flex flex-col">
              <span className="text-[10px] text-amber-600 font-mono mb-0.5">{appt.time}</span>
              <div className="p-3 rounded-lg bg-surface-tertiary border border-border-subtle hover:border-border transition-colors">
                <div className="text-sm text-gray-200 font-medium leading-tight mb-1">
                  {appt.title}
                </div>
                <div className="text-[11px] text-gray-500">
                  {new Date(appt.date).toLocaleDateString()} with {appt.leadName}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

interface InvoicesTabProps {
  invoices: InvoiceDisplay[]
  direction: SlideDirection
}

// Memoized InvoicesTab component (rerender-memo)
const InvoicesTab = memo(function InvoicesTab({ invoices, direction }: InvoicesTabProps) {
  const animationClass = direction === 'right' ? 'animate-slideInRight' : 'animate-slideInLeft'

  return (
    <div className={`space-y-2 ${animationClass}`}>
      {invoices.map((inv) => (
        <div
          key={inv.id}
          className="flex justify-between items-center p-3 rounded-lg bg-surface-tertiary border border-border-subtle hover:border-border transition-colors group"
        >
          <div className="flex flex-col">
            <span className="text-sm text-gray-200 font-medium">{inv.leadName}</span>
            <span className="text-[10px] text-gray-600 font-mono mt-0.5 tracking-tight group-hover:text-gray-500 transition-colors">
              #{inv.id.split('-')[1] || inv.id.slice(-4)}
            </span>
          </div>
          <div className="text-right">
            <div className="text-sm font-medium text-gray-200">${inv.amount}</div>
            <div className="mt-1 flex justify-end">
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  inv.status === 'paid'
                    ? 'text-emerald-500 border-emerald-900/30 bg-emerald-900/10'
                    : inv.status === 'sent'
                      ? 'text-blue-500 border-blue-900/30 bg-blue-900/10'
                      : 'text-amber-500 border-amber-900/30 bg-amber-900/10'
                }`}
              >
                {inv.status}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
})

// ============================================
// MAIN DASHBOARD VIEW
// ============================================

const TABS: DashboardTab[] = ['leads', 'schedule', 'invoices']

const TAB_ICONS: Record<DashboardTab, React.ReactNode> = {
  leads: <Users className="w-3.5 h-3.5" />,
  schedule: <Calendar className="w-3.5 h-3.5" />,
  invoices: <FileText className="w-3.5 h-3.5" />,
}

export function DashboardView({
  user,
  leads,
  appointments,
  invoices,
  onSignOut,
  isSigningOut,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('leads')
  const [direction, setDirection] = useState<SlideDirection>('right')
  const [selectedLead, setSelectedLead] = useState<LeadDisplay | null>(null)

  const handleTabChange = (tab: DashboardTab) => {
    if (tab === activeTab) return
    const currentIndex = TABS.indexOf(activeTab)
    const newIndex = TABS.indexOf(tab)
    setDirection(newIndex > currentIndex ? 'right' : 'left')
    setActiveTab(tab)
  }

  // Show lead detail view
  if (selectedLead) {
    return <LeadDetail lead={selectedLead} onBack={() => setSelectedLead(null)} />
  }

  return (
    <div className="h-full flex flex-col bg-surface-secondary">
      {/* Tabs */}
      <div className="px-4 pt-4 pb-4">
        <div className="relative flex p-1 bg-surface-elevated rounded-lg border border-surface-muted">
          {/* Animated Pill Background */}
          <div
            className="absolute top-1 bottom-1 rounded-md bg-[#222] shadow-sm transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
            style={{
              width: 'calc((100% - 8px) / 3)',
              transform: `translateX(${
                activeTab === 'leads' ? '0%' : activeTab === 'schedule' ? '100%' : '200%'
              })`,
              left: '4px',
            }}
          />

          {TABS.map((tab) => (
            <Button
              key={tab}
              onClick={() => handleTabChange(tab)}
              variant="ghost"
              size="sm"
              className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2 text-[11px] font-medium rounded-md capitalize transition-colors duration-200 ${
                activeTab === tab
                  ? 'text-gray-100'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-transparent'
              }`}
            >
              <span
                className={`transition-colors duration-200 ${
                  activeTab === tab ? 'text-amber-500' : 'opacity-70 group-hover:opacity-100'
                }`}
              >
                {TAB_ICONS[tab]}
              </span>
              {tab}
            </Button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-4 custom-scrollbar pb-6 overflow-x-hidden">
        {activeTab === 'leads' && (
          <LeadsTab leads={leads} direction={direction} onSelectLead={setSelectedLead} />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab appointments={appointments} direction={direction} />
        )}
        {activeTab === 'invoices' && <InvoicesTab invoices={invoices} direction={direction} />}
      </div>

      {/* Bottom: User Profile & Actions */}
      <div className="border-t border-border-subtle mt-auto">
        <div className="p-3">
          <div className="flex items-center gap-3 p-2 rounded-xl bg-surface-tertiary border border-border-subtle">
            {/* Avatar */}
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-900/40 to-amber-700/20 border border-amber-900/40 flex items-center justify-center text-amber-500 text-xs font-bold shrink-0">
              {(user.name || user.email).charAt(0).toUpperCase()}
            </div>

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">{user.name || 'User'}</p>
              <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
            </div>

            {/* Settings Icon */}
            <Link
              href="/settings"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-300 hover:bg-border-subtle transition-all"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </Link>
          </div>

          {/* Sign Out Button */}
          <button
            type="button"
            onClick={onSignOut}
            disabled={isSigningOut}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-red-400 rounded-lg transition-all disabled:opacity-50"
          >
            <LogOut className="w-3.5 h-3.5" />
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  )
}
