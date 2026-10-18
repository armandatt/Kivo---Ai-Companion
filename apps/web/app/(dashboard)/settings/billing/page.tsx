import { Suspense } from 'react'
import { BillingPage } from '@/components/billing/billing-page'

export default function SettingsBillingPage() {
  return <Suspense fallback={null}><BillingPage /></Suspense>
}
