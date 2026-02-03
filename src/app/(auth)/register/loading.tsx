import { SkeletonAuthForm } from '@/components/ui/Skeleton'

export default function RegisterLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <SkeletonAuthForm />
    </div>
  )
}
