'use client'

import { type FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isValidSignupEmail, normalizeEmail, passwordProblem } from '@repo/api/auth/email-rules'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import {
  AuthError,
  AuthMethodChoice,
  AuthNotice,
  AuthShell,
  BackButton,
  authInputClass,
  authPrimaryButtonClass,
} from '@/components/auth/auth-shell'

const CODE_LENGTH = 8
const RESEND_WAIT_SECONDS = 60

type Step = 'choose' | 'email' | 'verify'

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('choose')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  // Proves to the server that this browser started the signup. Kept in memory
  // only: reloading the page means starting again.
  const [signupToken, setSignupToken] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  // Counts down to when another code may be requested.
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  const post = (path: string, body: Record<string, string>) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const handleStart = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setNotice('')

    // The same checks the server makes, so a typo is caught before a round trip.
    const normalized = normalizeEmail(email)
    if (!normalized || !isValidSignupEmail(normalized)) {
      setError('Enter a valid email address')
      return
    }
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)
    setIsRetrying(false)

    const attempt = () => post('/api/signup', { email: normalized, password })

    try {
      let res = await attempt()

      if (res.status >= 500 && res.status !== 503) {
        setIsRetrying(true)
        await new Promise((resolve) => setTimeout(resolve, 2000))
        res = await attempt()
      }

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Could not create your account')
        return
      }

      setEmail(normalized)
      setSignupToken(typeof data.signupToken === 'string' ? data.signupToken : '')
      setCode('')
      setResendIn(RESEND_WAIT_SECONDS)
      setStep('verify')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
      setIsRetrying(false)
    }
  }

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (code.length !== CODE_LENGTH) return
    setError('')
    setNotice('')
    setIsLoading(true)

    try {
      const res = await post('/api/signup/verify', { email, code, signupToken })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Could not verify that code')
        setCode('')
        return
      }

      router.push('/onboarding')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    setError('')
    setNotice('')
    setIsLoading(true)

    try {
      const res = await post('/api/signup/resend', { email, signupToken })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Could not send a new code')
        if (typeof data.retryAfterSeconds === 'number') setResendIn(data.retryAfterSeconds)
        return
      }

      setCode('')
      setNotice('If this signup is still open, we sent a new code. The previous one no longer works.')
      setResendIn(RESEND_WAIT_SECONDS)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (step === 'verify') {
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            Enter the 8-digit code we sent to <span className="text-paper-50">{email}</span>. It expires in 10 minutes.
          </>
        }
      >
        <form onSubmit={handleVerify} className="space-y-4">
          <div className="flex justify-center">
            <InputOTP
              maxLength={CODE_LENGTH}
              value={code}
              onChange={setCode}
              inputMode="numeric"
              pattern="^[0-9]*$"
              autoFocus
              aria-label="Verification code"
            >
              <InputOTPGroup>
                {Array.from({ length: CODE_LENGTH }, (_, index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="h-11 w-7 text-base sm:w-10 sm:text-lg text-paper-50 border-ink-700 bg-ink-950"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          {error && <AuthError>{error}</AuthError>}
          {notice && <AuthNotice>{notice}</AuthNotice>}

          <Button
            type="submit"
            disabled={isLoading || code.length !== CODE_LENGTH}
            className={`${authPrimaryButtonClass} mt-6`}
          >
            {isLoading ? 'Verifying...' : 'Verify and continue'}
          </Button>
        </form>

        <p className="text-center text-sm text-ink-300 mt-6">
          Didn&apos;t get it? Check spam, or{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={isLoading || resendIn > 0}
            className="text-keppel-300 hover:text-keppel-200 font-medium disabled:text-ink-400 disabled:cursor-not-allowed"
          >
            {resendIn > 0 ? `resend in ${resendIn}s` : 'send a new code'}
          </button>
          .
        </p>

        <p className="text-center text-xs text-ink-300 mt-3">
          If this email already has an account, we sent a reminder to sign in instead of a code.
        </p>

        <BackButton onClick={() => { setStep('email'); setError(''); setNotice('') }}>
          ← Use a different email
        </BackButton>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={<>Join <span className="text-keppel-300">Kivo</span></>}
      subtitle="Create your AI companion today"
    >
      {step === 'choose' ? (
        <AuthMethodChoice onEmail={() => setStep('email')} />
      ) : (
        <>
          <form onSubmit={handleStart} className="space-y-4" noValidate>
            <div>
              <label htmlFor="signup-email" className="block text-sm font-medium text-ink-200 mb-2">
                Email address
              </label>
              <Input
                id="signup-email"
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
              <label htmlFor="signup-password" className="block text-sm font-medium text-ink-200 mb-2">
                Password
              </label>
              <Input
                id="signup-password"
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
              <label htmlFor="signup-confirm" className="block text-sm font-medium text-ink-200 mb-2">
                Confirm Password
              </label>
              <Input
                id="signup-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={authInputClass}
                required
              />
            </div>

            {error && <AuthError>{error}</AuthError>}

            <Button type="submit" disabled={isLoading} className={`${authPrimaryButtonClass} mt-6`}>
              {isRetrying
                ? 'Connecting...'
                : isLoading
                  ? 'Sending code...'
                  : 'Send verification code'}
            </Button>
          </form>

          <BackButton onClick={() => { setStep('choose'); setError('') }}>
            ← Other ways to sign up
          </BackButton>
        </>
      )}

      <p className="text-center text-ink-300 mt-6">
        Already have an account?{' '}
        <Link
          href="/signin"
          className="text-keppel-300 hover:text-keppel-200 font-semibold"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
