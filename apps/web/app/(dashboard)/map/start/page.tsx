import type { Metadata } from 'next'
import { FirstMap } from '@/components/nova/portable/first-map'

export const metadata: Metadata = { title: 'Your Knowledge Map starts here' }

export default function FirstMapPage() {
  return <FirstMap />
}
