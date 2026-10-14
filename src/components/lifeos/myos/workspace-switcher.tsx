'use client'

import { useEffect, useState } from 'react'
import { Building2, Check, ChevronDown, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type GrantedWorkspace = {
  workspaceId: string
  slug: string
  displayName: string
  kind: string
  configured: boolean
  applicationTarget: string | null
}

export function useGrantedWorkspaces() {
  const [workspaces, setWorkspaces] = useState<GrantedWorkspace[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/platform/workspaces', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP_${response.status}`)
        const value = await response.json() as { workspaces?: GrantedWorkspace[] }
        setWorkspaces(Array.isArray(value.workspaces) ? value.workspaces : [])
        setStatus('ready')
      })
      .catch(error => {
        if (error instanceof Error && error.name === 'AbortError') return
        setWorkspaces([])
        setStatus('error')
      })
    return () => controller.abort()
  }, [])

  return { workspaces, status }
}

function WorkspaceLink({ workspace, compact = false }: { workspace: GrantedWorkspace; compact?: boolean }) {
  return (
    <a
      href={`/workspace/${encodeURIComponent(workspace.slug)}`}
      className={compact
        ? 'flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-accent/60'
        : 'flex min-h-10 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/60'}
      aria-label={`Open ${workspace.displayName}${workspace.configured ? '' : ' (not configured)'}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Building2 className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{workspace.displayName}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {workspace.configured ? '已授权工作台' : '已授权 · 尚未配置入口'}
        </span>
      </span>
      {workspace.configured ? <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
    </a>
  )
}

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { workspaces, status } = useGrantedWorkspaces()
  const businessWorkspaces = workspaces.filter(workspace => workspace.kind !== 'lifeos')
  const disabled = status === 'loading' || businessWorkspaces.length === 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={compact
            ? 'h-11 w-full justify-start gap-2 px-2.5 text-left'
            : 'h-12 w-full justify-start gap-2.5 px-2.5 text-left'}
          aria-label="切换业务工作台"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">myOS 个人空间</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {status === 'loading' ? '正在读取已授权工作台…'
                : status === 'error' ? '工作台暂不可用'
                  : businessWorkspaces.length ? `${businessWorkspaces.length} 个已授权工作台`
                    : '尚未接入业务工作台'}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(22rem,calc(100vw-1rem))]">
        <DropdownMenuLabel>切换业务工作台</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {status === 'error' ? (
          <DropdownMenuItem disabled>无法读取授权列表，请稍后重试</DropdownMenuItem>
        ) : businessWorkspaces.length ? businessWorkspaces.map(workspace => (
          <DropdownMenuItem key={workspace.workspaceId} asChild>
            <WorkspaceLink workspace={workspace} />
          </DropdownMenuItem>
        )) : (
          <DropdownMenuItem disabled>
            {status === 'loading' ? '正在读取…' : '没有已授权的业务工作台'}
          </DropdownMenuItem>
        )}
        {status === 'ready' && workspaces.some(workspace => workspace.kind === 'lifeos') ? (
          <><DropdownMenuSeparator /><DropdownMenuItem disabled><Check className="mr-2 h-4 w-4" />当前：myOS 个人空间</DropdownMenuItem></>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function GrantedWorkspaceList({ compact = false }: { compact?: boolean }) {
  const { workspaces, status } = useGrantedWorkspaces()
  const businessWorkspaces = workspaces.filter(workspace => workspace.kind !== 'lifeos')

  if (status === 'loading') return <p className="text-sm text-muted-foreground">正在读取账号已授权的工作台…</p>
  if (status === 'error') return <p role="status" className="text-sm text-muted-foreground">工作台授权列表暂不可用。</p>
  if (!businessWorkspaces.length) return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">暂无已授权的业务工作台。接入后会显示在这里。</p>

  return <div className={compact ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-2'}>
    {businessWorkspaces.map(workspace => <WorkspaceLink key={workspace.workspaceId} workspace={workspace} compact />)}
  </div>
}
