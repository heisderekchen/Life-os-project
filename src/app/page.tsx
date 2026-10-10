import { AppShell } from '@/components/lifeos/app-shell'

export default function Home() {
  // The HappySpa Worker protects every /workbench/* request with its scoped
  // private-workbench session before this static shell or its assets are served.
  return <AppShell />
}
