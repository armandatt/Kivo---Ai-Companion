// Wording for the Knowledge contract's values. Labels only.

import type { KnowledgeLevel, KnowledgeOutcome, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'
import { relativeDay } from '../format'

export const LEVEL_LABEL: Record<KnowledgeLevel, string> = {
  unverified: 'Not studied in a session yet',
  weak:       'Weak',
  developing: 'Developing',
  solid:      'Solid',
}

export const LEVEL_TONE: Record<KnowledgeLevel, string> = {
  unverified: 'bg-white/20',
  weak:       'bg-amber-300/80',
  developing: 'bg-keppel-400/60',
  solid:      'bg-keppel-400',
}

export const OUTCOME_LABEL: Record<KnowledgeOutcome, string> = {
  struggled: 'Struggled', okay: 'Okay', good: 'Good', crushed_it: 'Crushed it',
}

export function reviewLabel(topic: Pick<KnowledgeTopic, 'reviewState' | 'nextReviewAt' | 'daysOverdue'>): string {
  if (topic.reviewState === 'due') {
    return topic.daysOverdue > 0 ? `Review due · ${topic.daysOverdue} day${topic.daysOverdue === 1 ? '' : 's'} overdue` : 'Review due'
  }
  if (topic.reviewState === 'scheduled' && topic.nextReviewAt) return `Review ${relativeDay(topic.nextReviewAt)}`
  return 'No review scheduled'
}

export function sessionsLabel(count: number): string {
  return count === 0 ? 'No sessions yet' : `${count} session${count === 1 ? '' : 's'}`
}
