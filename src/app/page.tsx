import { AppShell } from '@/components/lifeos/app-shell'
import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'

export default async function Home() {
  const entryKey = process.env.LIFEOS_ENTRY_KEY
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()])

  if (
    !entryKey
    || requestHeaders.get('x-lifeos-gateway-key') !== entryKey
    || cookieStore.get('lifeos_session')?.value !== entryKey
  ) {
    notFound()
  }

  return <AppShell />
}
