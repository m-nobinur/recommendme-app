'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  AuthContainer,
  AuthFooterLink,
  AuthHeader,
  FormError,
  FormField,
  FormInput,
} from '@/components/ui/Form'
import { Logo } from '@/components/ui/Logo'
import { signIn } from '@/lib/auth/client'
import { ROUTES } from '@/lib/constants'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const result = await signIn.email({
        email,
        password,
      })

      if (result.error) {
        setError(result.error.message || 'Invalid credentials')
        setIsLoading(false)
        return
      }

      if (result.data) {
        if (callbackUrl) {
          window.location.href = callbackUrl
        } else {
          router.push(ROUTES.CHAT)
        }
      }
    } catch (err: unknown) {
      console.error('[Login] Error:', err)
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  const logoElement = (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-linear-to-br from-[#121212] to-surface-muted shadow-xl">
      <Logo size={40} />
    </div>
  )

  return (
    <AuthContainer>
      <AuthHeader title="Welcome back" subtitle="Sign in to your Reme account" logo={logoElement} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={error} />

        <FormField>
          <FormInput
            id="email"
            type="email"
            label="Email"
            value={email}
            onChange={setEmail}
            required
            placeholder="you@example.com"
          />

          <FormInput
            id="password"
            type="password"
            label="Password"
            value={password}
            onChange={setPassword}
            required
            placeholder="Enter your password"
          />
        </FormField>

        <Button type="submit" variant="primary" isLoading={isLoading} className="mt-6 h-12 w-full">
          Sign In
        </Button>
      </form>

      <AuthFooterLink text="Don't have an account?" linkText="Create one" href={ROUTES.REGISTER} />
    </AuthContainer>
  )
}
