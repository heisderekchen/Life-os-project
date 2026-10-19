'use client'

import type { ReactElement } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'

export interface WorkspaceAction { id: string; label: string; run: () => void; destructive?: boolean; disabled?: boolean }
export interface WorkspaceMenu { label: string; actions: WorkspaceAction[]; onOpen: () => void }

export function WorkspaceContextMenu({ menu, children }: { menu?: WorkspaceMenu; children: ReactElement }) {
  if (!menu?.actions.length) return children
  return <ContextMenu modal={false} onOpenChange={open => { if (open) menu.onOpen() }}>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent className="workspace-context-menu">
      <ContextMenuLabel className="max-w-60 truncate">{menu.label}</ContextMenuLabel><ContextMenuSeparator />
      {menu.actions.map(action => <ContextMenuItem key={action.id} disabled={action.disabled} variant={action.destructive ? 'destructive' : 'default'} onSelect={action.run}>{action.label}</ContextMenuItem>)}
    </ContextMenuContent>
  </ContextMenu>
}

// The same commands stay available to touch users and without a right mouse button.
export function WorkspaceActionsButton({ menu, zh }: { menu: WorkspaceMenu; zh: boolean }) {
  return <DropdownMenu modal={false} onOpenChange={open => { if (open) menu.onOpen() }}>
    <DropdownMenuTrigger asChild><button type="button" className="workspace-actions-button nodrag nopan" aria-label={`${zh ? '快捷操作' : 'Actions'} ${menu.label}`} onClick={event => event.stopPropagation()}><MoreHorizontal size={16} /></button></DropdownMenuTrigger>
    <DropdownMenuContent className="workspace-context-menu" align="end"><DropdownMenuLabel className="max-w-60 truncate">{menu.label}</DropdownMenuLabel><DropdownMenuSeparator />{menu.actions.map(action => <DropdownMenuItem key={action.id} disabled={action.disabled} variant={action.destructive ? 'destructive' : 'default'} onSelect={action.run}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>
}
