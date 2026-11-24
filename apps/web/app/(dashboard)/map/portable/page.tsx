import type { Metadata } from 'next'
import { PortableMaps } from '@/components/nova/portable/portable-maps'

export const metadata: Metadata = { title: 'Share Knowledge Maps' }

export default function PortableMapsPage() {
  return <PortableMaps />
}
