'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthError, AuthShell, authInputClass, authLabelClass, authLinkClass, authPrimaryButtonClass } from '@/components/auth/auth-shell'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Read once, then taken out of the address bar, so the link's token is not
  // left in the history or shown to anyone looking at the screen.
  const [token] = useState(() => searchParams.get('token'))
  useEffect(() => {
    if (token && new URLSearchParams(window.location.search).has('token')) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [token])

  // Whether the link still works, asked as the page opens, so nobody types a
  // new password into a link that was already used or replaced.
  const [usable, setUsable] = useState<'checking' | 'yes' | 'no' | 'unknown'>('checking')
  useEffect(() => {
    if (!token) return
    let live = true
    fetch('/api/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, check: true }) })
      .then(async res => { const data = await res.json().catch(() => null); if (live) setUsable(res.ok && data?.usable ? 'yes' : data && data.usable === false ? 'no' : 'unknown') })
      .catch(() => { if (live) setUsable('unknown') })
    return () => { live = false }
  }, [token])

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  if (!token || usable === 'no') {
    return (
      <AuthShell title="This link can’t be used" subtitle="Reset links work once and last an hour.">
        <AuthError>{token ? 'This link has expired or was already used. Only the newest reset email works.' : 'This reset link is incomplete. Open it from the email again, or ask for a new one.'}</AuthError>
        <p className="mt-6 text-center">
          <Link href="/forgot-password" className={`text-sm ${authLinkClass}`}>
            Request a new reset link →
          </Link>
        </p>
      </AuthShell>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)

    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      router.push('/signin?reset=success')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (usable === 'checking') {
    return <AuthShell title="Set a new password" subtitle="Checking your reset link…"><p className="text-sm text-center opacity-70" role="status" data-reset-checking>One moment.</p></AuthShell>
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a strong password for your account.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="reset-password" className={authLabelClass}>
            New password
          </label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            required
          />
        </div>

        <div>
          <label htmlFor="reset-confirm" className={authLabelClass}>
            Confirm password
          </label>
          <Input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Confirm your new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={authInputClass}
            required
          />
        </div>

        {error && <AuthError>{error}</AuthError>}

        <Button type="submit" disabled={isLoading} className={`${authPrimaryButtonClass} mt-6`}>
          {isLoading ? 'Saving...' : 'Reset password'}
        </Button>
      </form>
    </AuthShell>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
