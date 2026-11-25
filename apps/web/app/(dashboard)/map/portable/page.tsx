import { redirect } from 'next/navigation'

// The old combined page: sharing and importing are now separate pages
// (/map/share, /map/import). Links to this address keep working.
export default function PortableMapsPage() {
  redirect('/map/share')
}
