'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { getTranslation, useTranslation } from '@/lib/i18n'

type Account = {
  accountId: string
  username: string
  displayName: string
  role: string
  legacyOwner: boolean
  enabled: boolean
  workspaces: string[]
}
type Workspace = {
  workspaceId: string
  slug: string
  displayName: string
  kind: string
  configured: boolean
}

function translatedValue(dictionary: Record<string, unknown>, key: string): string {
  let value: unknown = dictionary
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return key
    value = (value as Record<string, unknown>)[part]
  }
  return typeof value === 'string' ? value : key
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `HTTP_${response.status}`)
  }
  if (response.status === 204) return {} as T
  return response.json() as Promise<T>
}

export function PlatformAccountsPage() {
  const { language } = useTranslation()
  const t = useMemo(() => {
    const current = getTranslation(language) as unknown as Record<string, unknown>
    const fallback = getTranslation('en') as unknown as Record<string, unknown>
    return (key: string) => {
      const value = translatedValue(current, key)
      return value === key ? translatedValue(fallback, key) : value
    }
  }, [language])
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [passwordTarget, setPasswordTarget] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  const refresh = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError('')
    try {
      const session = await request<{ principal?: { role?: string } }>('/api/platform/session')
      if (session.principal?.role !== 'platform_admin') {
        setAuthorized(false)
        return false
      }
      setAuthorized(true)
      const [accountResult, workspaceResult] = await Promise.all([
        request<{ accounts: Account[] }>('/api/platform/admin/accounts'),
        request<{ workspaces: Workspace[] }>('/api/platform/admin/workspaces'),
      ])
      setAccounts(accountResult.accounts || [])
      setWorkspaces(workspaceResult.workspaces || [])
      return true
    } catch (caught) {
      setAuthorized(false)
      setError(caught instanceof Error ? caught.message : t('platformAdmin.loadFailed'))
      return false
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void refresh() }, [refresh])

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (await refresh()) setNotice(success)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('platformAdmin.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const createAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedUsername = username.trim().toLowerCase()
    void runAction(async () => {
      await request('/api/platform/admin/accounts', {
        method: 'POST', body: JSON.stringify({ username: normalizedUsername, displayName: displayName.trim() }),
      })
      setUsername('')
      setDisplayName('')
    }, t('platformAdmin.accountCreated'))
  }

  const setAccountPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!passwordTarget) return
    const target = passwordTarget
    const suppliedPassword = password
    void runAction(async () => {
      try {
        await request(`/api/platform/admin/accounts/${encodeURIComponent(target)}/password`, {
          method: 'POST', body: JSON.stringify({ password: suppliedPassword }),
        })
        setPasswordTarget(null)
      } finally {
        setPassword('')
        setPasswordConfirm('')
      }
    }, t('platformAdmin.passwordUpdated'))
  }

  const toggleEnabled = (account: Account, enabled: boolean) => {
    if (!enabled && !window.confirm(`${t('platformAdmin.confirmDisable')} @${account.username}? ${t('platformAdmin.disableSessionsNotice')}`)) return
    return runAction(() => request(
      `/api/platform/admin/accounts/${encodeURIComponent(account.accountId)}/enabled`,
      { method: 'POST', body: JSON.stringify({ enabled }) },
    ), t(enabled ? 'platformAdmin.accountEnabled' : 'platformAdmin.accountDisabled'))
  }

  const toggleWorkspace = (account: Account, workspace: Workspace, granted: boolean) => {
    if (!granted && !window.confirm(`${t('platformAdmin.confirmRevoke')} ${workspace.displayName} for @${account.username}?`)) return
    return runAction(() => request(
      `/api/platform/admin/accounts/${encodeURIComponent(account.accountId)}/workspaces`,
      { method: 'POST', body: JSON.stringify({ workspaceId: workspace.workspaceId, granted }) },
    ), t('platformAdmin.permissionsUpdated'))
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground" role="status">{t('platformAdmin.loading')}</div>
  if (!authorized) return <section className="mx-auto max-w-3xl p-4 sm:p-8" aria-labelledby="platform-admin-title">
    <Card><CardHeader><CardTitle id="platform-admin-title">{t('platformAdmin.title')}</CardTitle>
      <CardDescription>{error || t('platformAdmin.accessDenied')}</CardDescription></CardHeader></Card>
  </section>

  return <main className="mx-auto h-full max-w-5xl space-y-5 overflow-y-auto p-4 pb-12 sm:p-8" aria-labelledby="platform-admin-title">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-2.5 text-primary"><ShieldCheck className="h-5 w-5" /></span>
        <div><h1 id="platform-admin-title" className="text-xl font-semibold">{t('platformAdmin.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('platformAdmin.description')}</p></div>
      </div>
      <Button variant="outline" onClick={() => void refresh()} disabled={busy}>
        <RefreshCw className="mr-2 h-4 w-4" />{t('platformAdmin.refresh')}
      </Button>
    </header>

    {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">{notice}</p>}

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4" />{t('platformAdmin.createAccount')}</CardTitle>
        <CardDescription>{t('platformAdmin.createAccountDescription')}</CardDescription></CardHeader>
      <CardContent><form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={createAccount}>
        <label className="space-y-1 text-sm"><span>{t('platformAdmin.username')}</span><Input required minLength={3} maxLength={64} pattern="[a-z0-9][a-z0-9._-]{2,63}" autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label className="space-y-1 text-sm"><span>{t('platformAdmin.displayName')}</span><Input maxLength={80} autoComplete="off" value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>
        <Button className="self-end" type="submit" disabled={busy}><UserPlus className="mr-2 h-4 w-4" />{t('platformAdmin.create')}</Button>
      </form></CardContent>
    </Card>

    <section className="space-y-3" aria-labelledby="accounts-list-title">
      <h2 id="accounts-list-title" className="flex items-center gap-2 text-base font-semibold"><UsersRound className="h-4 w-4" />{t('platformAdmin.accounts')} <span className="text-sm font-normal text-muted-foreground">({accounts.length})</span></h2>
      {accounts.map(account => {
        const fixedAccount = account.legacyOwner || account.role === 'platform_admin'
        return <Card key={account.accountId}>
          <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><CardTitle className="text-base">{account.displayName}</CardTitle>
              <CardDescription className="mt-1 break-all">@{account.username} · {account.role} · {account.accountId}</CardDescription></div>
            <div className="flex items-center gap-2 text-sm"><span>{account.enabled ? t('platformAdmin.enabled') : t('platformAdmin.disabled')}</span>
              <Switch checked={account.enabled} disabled={busy || fixedAccount} aria-label={`${t('platformAdmin.accountStatus')} ${account.username}`} onCheckedChange={enabled => void toggleEnabled(account, enabled)} />
            </div>
          </div></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="mb-2 text-sm font-medium">{t('platformAdmin.workspaceAccess')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {workspaces.map(workspace => {
                  const reserved = workspace.kind === 'lifeos' || workspace.workspaceId === 'ws_lifeos_legacy'
                  const granted = account.workspaces.includes(workspace.workspaceId)
                  return <div key={workspace.workspaceId} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
                    <span className="min-w-0"><span className="block truncate font-medium">{workspace.displayName}</span>
                      <span className="block text-xs text-muted-foreground">{workspace.slug} · {workspace.configured ? t('platformAdmin.configured') : t('platformAdmin.notConfigured')}</span></span>
                    <Switch checked={granted} disabled={busy || fixedAccount || reserved} aria-label={`${workspace.displayName} ${account.username}`} onCheckedChange={value => void toggleWorkspace(account, workspace, value)} />
                  </div>
                })}
              </div>
              {fixedAccount && <p className="mt-2 text-xs text-muted-foreground">{t('platformAdmin.adminWorkspaceNotice')}</p>}
            </div>
            {!fixedAccount && <div className="border-t border-border/60 pt-3">
              {passwordTarget === account.accountId ? <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={setAccountPassword}>
                <label className="flex-1 space-y-1 text-sm"><span>{t('platformAdmin.newPassword')}</span>
                  <Input aria-label={t('platformAdmin.newPassword')} type="password" required minLength={14} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
                  <span className="block text-xs text-muted-foreground">{t('platformAdmin.passwordRequirements')}</span>
                  <span className="mt-2 block">{t('platformAdmin.confirmPassword')}</span>
                  <Input aria-label={t('platformAdmin.confirmPassword')} type="password" required minLength={14} maxLength={128} autoComplete="new-password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} aria-invalid={Boolean(passwordConfirm && password !== passwordConfirm)} />
                  {passwordConfirm && password !== passwordConfirm && <span role="alert" className="block text-xs text-destructive">{t('platformAdmin.passwordMismatch')}</span>}
                </label>
                <div className="flex gap-2"><Button type="submit" disabled={busy || password.length < 14 || password !== passwordConfirm}>{t('platformAdmin.savePassword')}</Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => { setPassword(''); setPasswordConfirm(''); setPasswordTarget(null) }}>{t('platformAdmin.cancel')}</Button></div>
              </form> : <Button variant="outline" size="sm" disabled={busy} onClick={() => { setPassword(''); setPasswordConfirm(''); setPasswordTarget(account.accountId) }}>
                <KeyRound className="mr-2 h-4 w-4" />{t('platformAdmin.setOrResetPassword')}
              </Button>}
            </div>}
          </CardContent>
        </Card>
      })}
      {!accounts.length && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('platformAdmin.noAccounts')}</p>}
    </section>
  </main>
}
