'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

export default function SigninPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setIsLoading(true)
    setError('')

    try {
      const res = await fetch('http://localhost:3000/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }

      // Redirect to quiz page
      window.location.href = 'http://localhost:3000/quiz'
    } catch (error) {
      console.error(error)
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#00D9A3]/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#FF8C42]/10 rounded-full blur-3xl animate-pulse" />

      <Card className="w-full max-w-md relative z-10 bg-[#1a1a24] border-[#2a2a35] shadow-2xl">
        <div className="p-8">

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              Welcome back
            </h1>

            <p className="text-gray-400">
              Sign in to your AI companion
            </p>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="space-y-4"
          >

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>

              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                className="bg-[#0a0a0a] border-[#2a2a35] text-white placeholder:text-gray-600 focus:border-[#00D9A3] focus:ring-[#00D9A3]"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>

              <Input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                className="bg-[#0a0a0a] border-[#2a2a35] text-white placeholder:text-gray-600 focus:border-[#00D9A3] focus:ring-[#00D9A3]"
                required
              />
            </div>

            {/* Forgot Password */}
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm text-[#00D9A3] hover:text-[#00c896] font-medium"
              >
                Forgot password?
              </Link>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#00D9A3] text-black hover:bg-[#00c896] font-semibold py-2 rounded-full transition-all duration-200 mt-6"
            >
              {isLoading
                ? 'Signing in...'
                : 'Sign in'}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-[#2a2a35]" />
            <span className="text-gray-500 text-sm">
              or
            </span>
            <div className="flex-1 h-px bg-[#2a2a35]" />
          </div>

          {/* Google */}
          <Button
            variant="outline"
            className="w-full bg-[#1a1a24] border-[#2a2a35] text-white hover:bg-[#2a2a35] py-2 rounded-full transition-all duration-200"
          >
            Continue with Google
          </Button>

          {/* Signup */}
          <p className="text-center text-gray-400 mt-6">
            Don&apos;t have an account?{' '}

            <Link
              href="/signup"
              className="text-[#00D9A3] hover:text-[#00c896] font-semibold"
            >
              Sign up
            </Link>
          </p>
        </div>
      </Card>
    </div>
  )
}