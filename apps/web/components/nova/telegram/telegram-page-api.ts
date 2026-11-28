// The Telegram page's requests (GET/POST /api/nova/telegram). The page holds
// no reminder state of its own: it shows what the server answers.
import type { NovaTelegramPage, TelegramPageAction } from '@repo/api/nova/product/telegram-page.types'

export async function loadTelegramPage(): Promise<NovaTelegramPage | { error: string }> {
  try {
    const res = await fetch('/api/nova/telegram', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { error: (data as { message?: string }).message ?? 'The Telegram page didn’t load.' }
    return data as NovaTelegramPage
  } catch {
    return { error: 'Network error. Check your connection and try again.' }
  }
}

export async function changeTelegram(action: TelegramPageAction): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/nova/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) })
    const data = await res.json().catch(() => ({})) as { ok?: boolean; message?: string }
    return res.ok && data.ok ? { ok: true } : { ok: false, message: data.message ?? 'That didn’t save. Try again.' }
  } catch {
    return { ok: false, message: 'Network error. Check your connection and try again.' }
  }
}
