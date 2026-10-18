'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthError, AuthNotice, AuthShell, authInputClass, authLabelClass, authLinkClass, authPrimaryButtonClass } from '@/components/auth/auth-shell'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      setSuccess(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your email and we'll send you a reset link.">
      {success ? (
        <div className="space-y-6">
          <AuthNotice>
            Check your inbox: if an account with that email exists, we&apos;ve sent a reset link. It expires in 1 hour.
          </AuthNotice>
          <p className="text-sm text-ink-300">
            Signed up with Google? Your account has no password to reset: go back and choose Continue with Google.
          </p>
          <Link href="/signin" className={`block text-center text-sm ${authLinkClass}`}>
            ← Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className={authLabelClass}>
              Email
            </label>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputClass}
              required
            />
          </div>

          {error && <AuthError>{error}</AuthError>}

          <Button type="submit" disabled={isLoading} className={`${authPrimaryButtonClass} mt-6`}>
            {isLoading ? 'Sending...' : 'Send reset link'}
          </Button>

          <p className="mt-4 text-center">
            <Link href="/signin" className={`text-sm ${authLinkClass}`}>
              ← Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  )
}
