'use client'

import { Suspense, type FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parkCapture } from '@/components/nova/saved/pending-capture'
import { parkNoteCapture } from '@/components/nova/notes/pending-note-capture'
import {
  AuthError,
  AuthMethodChoice,
  AuthNotice,
  AuthShell,
  BackButton,
  authInputClass,
  authPrimaryButtonClass,
} from '@/components/auth/auth-shell'

// Why a Google sign-in came back here without signing in.
const GOOGLE_ERRORS: Record<string, string> = {
  google_denied: 'Google sign-in was cancelled.',
  google_config: 'Google sign-in is not available right now.',
  google_state: 'That Google sign-in expired. Please try again.',
  google_token: "We couldn't verify your Google account. Please try again.",
  token_exchange: "We couldn't verify your Google account. Please try again.",
  google_unverified: "Your Google account's email address is not verified.",
  google_link:
    'An account with this email already exists and uses a password, and we have not yet confirmed the email is yours. Nothing was changed. Reset your password once (we email you a link), then Continue with Google will work. You can also keep signing in with your password.',
  google_manual:
    'An account with this email already exists, and Google cannot confirm this address for us, so we did not connect them. Nothing was changed. Sign in with your email and password instead.',
  server_error: 'Something went wrong. Please try again.',
}

function SigninForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resetSuccess = searchParams.get('reset') === 'success'
  const googleError = GOOGLE_ERRORS[searchParams.get('error') ?? '']

  // Someone arriving from a password reset is here to type that password.
  const [step, setStep] = useState<'choose' | 'email'>(resetSuccess ? 'email' : 'choose')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)

  // Sent here by the Save to Kivo bookmark while signed out: keep the page
  // it was bringing, so Saved still has it after sign-in. Likewise a passage
  // on its way to Notes (the extension's or the bookmarklet's capture).
  useEffect(() => { parkCapture(); parkNoteCapture() }, [])

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    setIsRetrying(false)

    const attempt = () =>
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

    try {
      let res = await attempt()

      if (res.status >= 500) {
        setIsRetrying(true)
        await new Promise((resolve) => setTimeout(resolve, 2000))
        res = await attempt()
      }

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Could not sign you in')
        return
      }

      // Back to where they were headed, when that is a page of this site.
      const from = searchParams.get('from') ?? ''
      router.push(from.startsWith('/') && !from.startsWith('//') && !from.includes('\\') ? from : '/home')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
      setIsRetrying(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your AI companion">
      {resetSuccess && (
        <div className="mb-4">
          <AuthNotice>
            Password reset successfully, and your email is confirmed. Sign in with your new password. Continue with Google now works for this email too.
          </AuthNotice>
        </div>
      )}

      {googleError && (
        <div className="mb-4">
          <AuthError>
            {googleError}
            {searchParams.get('error') === 'google_link' && (
              <>
                {' '}
                <Link href="/forgot-password" className="underline font-medium">
                  Reset password
                </Link>
              </>
            )}
          </AuthError>
        </div>
      )}

      {step === 'choose' ? (
        <AuthMethodChoice onEmail={() => setStep('email')} />
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="signin-email" className="block text-sm font-medium text-ink-200 mb-2">
                Email
              </label>
              <Input
                id="signin-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authInputClass}
                autoFocus
                required
              />
            </div>

            <div>
              <label htmlFor="signin-password" className="block text-sm font-medium text-ink-200 mb-2">
                Password
              </label>
              <Input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={authInputClass}
                required
              />
            </div>

            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm text-keppel-300 hover:text-keppel-200 font-medium"
              >
                Forgot password?
              </Link>
            </div>

            {error && <AuthError>{error}</AuthError>}

            <Button type="submit" disabled={isLoading} className={`${authPrimaryButtonClass} mt-6`}>
              {isRetrying
                ? 'Connecting...'
                : isLoading
                  ? 'Signing in...'
                  : 'Sign in'}
            </Button>
          </form>

          <BackButton onClick={() => { setStep('choose'); setError('') }}>
            ← Other ways to sign in
          </BackButton>
        </>
      )}

      <p className="text-center text-ink-300 mt-6">
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          className="text-keppel-300 hover:text-keppel-200 font-semibold"
        >
          Sign up
        </Link>
      </p>
    </AuthShell>
  )
}

export default function SigninPage() {
  return (
    <Suspense fallback={null}>
      <SigninForm />
    </Suspense>
  )
}
