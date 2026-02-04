'use client'

import { useRouter } from 'next/navigation'
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
import { signUp } from '@/lib/auth/client'
import { LIMITS, ROUTES } from '@/lib/constants'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < LIMITS.MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${LIMITS.MIN_PASSWORD_LENGTH} characters`)
      return
    }

    setIsLoading(true)

    try {
      const result = await signUp.email({
        email,
        password,
        name,
      })

      if (result.error) {
        setError(result.error.message || 'Registration failed')
        setIsLoading(false)
        return
      }

      if (result.data) {
        router.push(ROUTES.CHAT)
      }
    } catch (err: unknown) {
      console.error('[Register] Error:', err)
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
      <AuthHeader
        title="Create your account"
        subtitle="Start managing your business with AI"
        logo={logoElement}
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={error} />

        <FormField>
          <FormInput
            id="name"
            type="text"
            label="Business Name"
            value={name}
            onChange={setName}
            required
            placeholder="Your Business Name"
          />

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
            minLength={LIMITS.MIN_PASSWORD_LENGTH}
            placeholder="At least 8 characters"
          />

          <FormInput
            id="confirmPassword"
            type="password"
            label="Confirm Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            required
            placeholder="Confirm your password"
          />
        </FormField>

        <Button type="submit" variant="primary" isLoading={isLoading} className="mt-6 h-12 w-full">
          Create Account
        </Button>
      </form>

      <AuthFooterLink text="Already have an account?" linkText="Sign in" href={ROUTES.LOGIN} />
    </AuthContainer>
  )
}
