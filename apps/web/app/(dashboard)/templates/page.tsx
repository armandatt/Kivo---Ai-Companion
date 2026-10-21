'use client'

import { Suspense } from 'react'
import { TemplateLibrary } from '@/components/nova/templates/template-library'

// The template library and Create with Nova (packages/api/src/nova/product/workspaces.ts).
export default function TemplatesPage() {
  return (
    <Suspense fallback={null}>
      <TemplateLibrary />
    </Suspense>
  )
}
