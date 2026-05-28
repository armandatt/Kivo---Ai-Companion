'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#00D9A3]/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#FF8C42]/10 rounded-full blur-3xl animate-pulse" />

      <Card className="w-full max-w-md relative z-10 bg-[#1a1a24] border-[#2a2a35] shadow-2xl">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Forgot password?</h1>
            <p className="text-gray-400">
              Enter your email and we&apos;ll send you a reset link.
            </p>
          </div>

          {success ? (
            <div className="space-y-6">
              <div className="rounded-md border border-[#00D9A3]/30 bg-[#00D9A3]/10 px-4 py-3 text-sm text-[#00D9A3]">
                Check your inbox — if an account with that email exists, we&apos;ve sent a reset link. It expires in 1 hour.
              </div>
              <Link
                href="/signin"
                className="block text-center text-sm text-[#00D9A3] hover:text-[#00c896] font-medium"
              >
                ← Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email
                </label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                {isLoading ? 'Sending...' : 'Send reset link'}
              </Button>

              <p className="text-center text-gray-400 mt-4">
                <Link href="/signin" className="text-[#00D9A3] hover:text-[#00c896] font-medium text-sm">
                  ← Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </Card>
    </div>
  )
}
