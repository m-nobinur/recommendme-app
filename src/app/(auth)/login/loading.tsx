import { SkeletonAuthForm } from '@/components/ui/Skeleton'

export default function LoginLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <SkeletonAuthForm />
    </div>
  )
}
