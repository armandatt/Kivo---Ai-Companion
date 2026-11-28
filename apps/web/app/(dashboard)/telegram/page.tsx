import { PageFrame } from '@/components/dashboard/page-states'
import { TelegramPage } from '@/components/nova/telegram/telegram-page'

export default function TelegramRoute() {
  return (
    <PageFrame width="wide">
      <TelegramPage />
    </PageFrame>
  )
}
