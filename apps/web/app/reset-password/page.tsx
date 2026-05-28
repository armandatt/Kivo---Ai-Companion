'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#1a1a24] border-[#2a2a35] shadow-2xl">
          <div className="p-8 text-center space-y-4">
            <p className="text-red-300">This reset link is invalid or has expired.</p>
            <Link href="/forgot-password" className="text-[#00D9A3] hover:text-[#00c896] text-sm font-medium">
              Request a new reset link →
            </Link>
          </div>
        </Card>
      </div>
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

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#00D9A3]/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#FF8C42]/10 rounded-full blur-3xl animate-pulse" />

      <Card className="w-full max-w-md relative z-10 bg-[#1a1a24] border-[#2a2a35] shadow-2xl">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Set new password</h1>
            <p className="text-gray-400">Choose a strong password for your account.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                New Password
              </label>
              <Input
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-[#0a0a0a] border-[#2a2a35] text-white placeholder:text-gray-600 focus:border-[#00D9A3] focus:ring-[#00D9A3]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Confirm Password
              </label>
              <Input
                type="password"
                placeholder="Confirm your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-[#0a0a0a] border-[#2a2a35] text-white placeholder:text-gray-600 focus:border-[#00D9A3] focus:ring-[#00D9A3]"
                required
              />
            </div>

            {error && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#00D9A3] text-black hover:bg-[#00c896] font-semibold py-2 rounded-full transition-all duration-200 mt-6"
            >
              {isLoading ? 'Saving...' : 'Reset password'}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
