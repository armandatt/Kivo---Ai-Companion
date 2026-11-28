import { redirect } from 'next/navigation'

// The first-map choice lives on the map page itself now (its empty state);
// this address stays for links already sent.
export default function FirstMapPage() {
  redirect('/map')
}
