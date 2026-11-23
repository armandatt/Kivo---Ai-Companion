import type { Metadata } from 'next'
import { PortableMaps } from '@/components/nova/portable/portable-maps'

export const metadata: Metadata = { title: 'Import and export maps' }

export default function PortableMapsPage() {
  return <PortableMaps />
}
