import { NoteEditor } from '@/components/nova/notes/note-editor'

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <NoteEditor key={id} noteId={id} />
}
