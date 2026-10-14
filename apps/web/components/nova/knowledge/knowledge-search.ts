import type { KnowledgeSubject } from '@repo/api/nova/product/knowledge.types'

// The Knowledge page's search: what the learner typed, against the names on
// record. A subject whose name matches is shown whole; otherwise only its
// topics whose names match, and the subject only if one does. Order is the
// server's. Pure, so it is tested without a page.
export function searchSubjects(subjects: KnowledgeSubject[], query: string): KnowledgeSubject[] {
  const q = query.trim().toLowerCase()
  if (!q) return subjects
  const found: KnowledgeSubject[] = []
  for (const subject of subjects) {
    if (subject.subjectName.toLowerCase().includes(q)) { found.push(subject); continue }
    const topics = subject.topics.filter(topic => topic.topicName.toLowerCase().includes(q))
    if (topics.length > 0) found.push({ ...subject, topics })
  }
  return found
}
