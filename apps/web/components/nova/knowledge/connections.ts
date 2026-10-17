import type { MapEdge, MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'

// What is connected to one topic on the learner's record, from the Knowledge
// Map's stored edges only:
//   filed        notes and saved pages filed under the topic
//   mentionedIn  notes whose [[links]] name the topic
//   related      other topics reached through one note, and that note: a
//                note filed under this topic that links to another topic,
//                a note filed under another topic that links to this one,
//                or a note that links to both
// A related topic is never inferred from a name or a model: each comes with
// the note the learner wrote that joins them. Map order throughout; nothing
// is ranked. Pure, so it is tested without a page.

type Topic = Extract<MapNode, { type: 'topic' }>
type Note  = Extract<MapNode, { type: 'note' }>
type Item  = Extract<MapNode, { type: 'note' | 'resource' }>

export type Relation = 'filed_here_links_there' | 'filed_there_links_here' | 'links_to_both'

export interface RelatedTopic { topic: Topic; via: Note; relation: Relation }

export interface TopicConnections {
  filed:       Item[]
  mentionedIn: Note[]
  related:     RelatedTopic[]
}

export function topicConnections(map: Pick<NovaKnowledgeMapReady, 'nodes' | 'edges'>, topicId: string): TopicConnections {
  const byId  = new Map(map.nodes.map(n => [n.id, n]))
  const edges = map.edges as MapEdge[]
  const node  = (id: string) => byId.get(id)
  const isNote  = (n: MapNode | undefined): n is Note => n?.type === 'note'
  const isTopic = (n: MapNode | undefined): n is Topic => n?.type === 'topic'

  const filed = edges
    .filter(e => e.kind === 'about_topic' && e.from === topicId)
    .map(e => node(e.to))
    .filter((n): n is Item => n?.type === 'note' || n?.type === 'resource')

  const mentionedIn = edges
    .filter(e => e.kind === 'links_to' && e.to === topicId)
    .map(e => node(e.from))
    .filter(isNote)

  // The topic each note is filed under, and the topics each note links to.
  const filedUnder = new Map<string, string>()
  const linksFrom  = new Map<string, string[]>()
  for (const e of edges) {
    if (e.kind === 'about_topic') filedUnder.set(e.to, e.from)
    if (e.kind === 'links_to' && isTopic(node(e.to))) linksFrom.set(e.from, [...(linksFrom.get(e.from) ?? []), e.to])
  }

  const related: RelatedTopic[] = []
  const seen = new Set<string>([topicId])
  const add = (otherId: string | undefined, via: Note, relation: Relation) => {
    const other = otherId === undefined ? undefined : node(otherId)
    if (!isTopic(other) || seen.has(other.id)) return
    seen.add(other.id)
    related.push({ topic: other, via, relation })
  }
  for (const item of filed) {
    if (!isNote(item)) continue
    for (const to of linksFrom.get(item.id) ?? []) add(to, item, 'filed_here_links_there')
  }
  for (const note of mentionedIn) {
    add(filedUnder.get(note.id), note, 'filed_there_links_here')
    for (const to of linksFrom.get(note.id) ?? []) add(to, note, 'links_to_both')
  }

  return { filed, mentionedIn, related }
}

export const RELATION_WORDS: Record<Relation, (note: string) => string> = {
  filed_here_links_there: note => `Your note “${note}”, filed here, links to it`,
  filed_there_links_here: note => `Your note “${note}”, filed there, links here`,
  links_to_both:          note => `Your note “${note}” links to both`,
}
