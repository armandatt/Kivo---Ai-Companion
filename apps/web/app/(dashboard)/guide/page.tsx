'use client'

import { useDashboardCompanion } from '@/components/dashboard-shell'
import { NovaGuide } from '@/components/guide/nova-guide'
import { RexGuide } from '@/components/guide/rex-guide'

// One address, two guides: each companion's own.
export default function GuidePage() {
  return useDashboardCompanion() === 'nova' ? <NovaGuide /> : <RexGuide />
}
