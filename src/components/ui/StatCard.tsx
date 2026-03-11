interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  centered?: boolean
}

export function StatCard({ label, value, sub, centered }: StatCardProps) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface-secondary p-4${centered ? ' text-center' : ''}`}
    >
      <p className={`mb-1 font-bold text-white${centered ? ' text-2xl' : ' text-xl'}`}>{value}</p>
      {sub && <p className="mb-1 text-xs text-text-muted">{sub}</p>}
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  )
}
