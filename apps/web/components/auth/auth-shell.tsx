import type { ReactNode } from 'react'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export const authInputClass =
  'bg-[#0a0a0a] border-[#2a2a35] text-white placeholder:text-gray-600 focus:border-[#00D9A3] focus:ring-[#00D9A3]'

export const authPrimaryButtonClass =
  'w-full bg-[#00D9A3] text-black hover:bg-[#00c896] font-semibold py-2 rounded-full transition-all duration-200'

/** The card every sign-in and sign-up step is shown in. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: ReactNode
  subtitle: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#00D9A3]/10 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#FF8C42]/10 rounded-full blur-3xl animate-pulse" />

      <Card className="w-full max-w-md relative z-10 bg-[#1a1a24] border-[#2a2a35] shadow-2xl">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
            <p className="text-gray-400">{subtitle}</p>
          </div>
          {children}
        </div>
      </Card>
    </div>
  )
}

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {children}
    </p>
  )
}

export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-[#00D9A3]/30 bg-[#00D9A3]/10 px-3 py-2 text-sm text-[#00D9A3]">
      {children}
    </p>
  )
}

/** The two ways in, shown before any form: email, or Google. */
export function AuthMethodChoice({ onEmail }: { onEmail: () => void }) {
  return (
    <div className="space-y-3">
      <Button type="button" onClick={onEmail} className={authPrimaryButtonClass}>
        <Mail className="w-5 h-5 mr-2" />
        Continue with email
      </Button>
      <GoogleButton />
    </div>
  )
}

export function GoogleButton() {
  return (
    <Button
      asChild
      variant="outline"
      className="w-full bg-[#1a1a24] border-[#2a2a35] text-white hover:bg-[#2a2a35] py-2 rounded-full transition-all duration-200"
    >
      <a href="/api/auth/google">
        <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </a>
    </Button>
  )
}

export function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-center text-sm text-gray-400 hover:text-white mt-4"
    >
      {children}
    </button>
  )
}
