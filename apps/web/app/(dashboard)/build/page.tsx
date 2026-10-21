'use client'

import { Suspense } from 'react'
import { BuilderPage } from '@/components/nova/builder/builder-page'

// Build with Nova (packages/api/src/nova/product/builder.ts).
export default function BuildPage() {
  return (
    <Suspense fallback={null}>
      <BuilderPage />
    </Suspense>
  )
}
