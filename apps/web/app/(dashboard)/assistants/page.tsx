import type { Metadata } from 'next'
import { AssistantsPage } from '@/components/connect/assistants-page'
import { PageFrame } from '@/components/dashboard/page-states'

export const metadata: Metadata = { title: 'AI assistants · Kivo' }

// Kivo inside Claude and ChatGPT: connect, see what is connected, disconnect.
export default function Page() {
  return <PageFrame><AssistantsPage /></PageFrame>
}
