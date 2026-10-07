import { AppShell } from '@/components/lifeos/app-shell'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'

export default async function Home() {
  const entryKey = process.env.LIFEOS_ENTRY_KEY
  const cookieStore = await cookies()

  if (!entryKey || cookieStore.get('lifeos_session')?.value !== entryKey) {
    notFound()
  }

  return <AppShell />
}
