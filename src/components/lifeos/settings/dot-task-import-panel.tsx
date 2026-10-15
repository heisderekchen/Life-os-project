'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileUp } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import { apiPath } from '@/lib/api/client'
import { useProfile } from '@/lib/api/hooks'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ImportSummary = {
  total: number
  willCreate: number
  alreadyImported: number
  previouslyDeleted: number
  needsReview: number
}

type ImportPreview = {
  summary: ImportSummary
  items: Array<{ title: string; action: string }>
}

async function postTaskImport(path: string, body: unknown) {
  const response = await fetch(apiPath(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `HTTP ${response.status}`)
  return result
}

export function DotTaskImportPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const profileQuery = useProfile()
  const targetAccount = [profileQuery.data?.name, profileQuery.data?.email].filter(Boolean).join(' · ')
  const inputRef = useRef<HTMLInputElement>(null)
  const [sourceFile, setSourceFile] = useState<{ name: string; data: Record<string, unknown> } | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [targetConfirmed, setTargetConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const previewFile = async (file: File) => {
    setError('')
    setSuccess('')
    setSourceFile(null)
    setPreview(null)
    setTargetConfirmed(false)
    setIsWorking(true)
    try {
      if (file.size > 900 * 1024) throw new Error(t('settings.dotImportTooLarge'))
      const data: unknown = JSON.parse(await file.text())
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(t('settings.dotImportInvalidFile'))
      const candidate = data as Record<string, unknown>
      if (!Array.isArray(candidate.tasks) || typeof candidate.title !== 'string') throw new Error(t('settings.dotImportInvalidFile'))
      const result = await postTaskImport('/api/tasks/import/preview', candidate) as ImportPreview
      setSourceFile({ name: file.name, data: candidate })
      setPreview(result)
      setTargetConfirmed(false)
      setDialogOpen(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.dotImportFailed'))
    } finally {
      setIsWorking(false)
    }
  }

  const confirmImport = async () => {
    if (!sourceFile || !preview?.summary.willCreate) return
    setError('')
    setIsWorking(true)
    try {
      const result = await postTaskImport('/api/tasks/import', { ...sourceFile.data, confirm: true }) as { imported: number }
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setSuccess(t('settings.dotImportSuccess', { count: result.imported }))
      setDialogOpen(false)
      setSourceFile(null)
      setPreview(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.dotImportFailed'))
    } finally {
      setIsWorking(false)
    }
  }

  return <section className="rounded-lg border p-4" aria-labelledby="dot-task-import-title">
    <h3 id="dot-task-import-title" className="font-medium">{t('settings.importDotTasks')}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{t('settings.dotImportDescription')}</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isWorking}>
        <FileUp className="mr-2 h-4 w-4" />{isWorking ? t('loading') : t('settings.chooseDotExport')}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label={t('settings.chooseDotExport')}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void previewFile(file)
          event.currentTarget.value = ''
        }}
      />
      {sourceFile && <span className="max-w-full truncate text-sm text-muted-foreground">{sourceFile.name}</span>}
    </div>
    {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    {success && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">{success}</p>}

    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!isWorking) setDialogOpen(open) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.dotImportPreviewTitle')}</DialogTitle>
          <DialogDescription>{t('settings.dotImportPreviewDescription', { name: sourceFile?.name || '' })}</DialogDescription>
        </DialogHeader>
        {preview && <div className="space-y-4">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t('settings.dotImportTargetAccount')}</p>
            <p className="mt-1 break-all text-sm font-medium">{targetAccount || t('loading')}</p>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <Checkbox checked={targetConfirmed} onCheckedChange={(checked) => setTargetConfirmed(checked === true)} disabled={!targetAccount} />
              <span>{t('settings.dotImportConfirmTarget')}</span>
            </label>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {([
              ['total', t('settings.dotImportTotal')],
              ['willCreate', t('settings.dotImportNew')],
              ['alreadyImported', t('settings.dotImportAlreadyImported')],
              ['previouslyDeleted', t('settings.dotImportPreviouslyDeleted')],
              ['needsReview', t('settings.dotImportNeedsReview')],
            ] as const).map(([key, label]) => <div key={key} className="rounded-md bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{preview.summary[key]}</dd>
            </div>)}
          </dl>
          {preview.summary.needsReview > 0 && <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" />{t('settings.dotImportNeedsReviewDescription')}</p>
            <ul className="mt-2 max-h-36 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
              {preview.items.filter((item) => item.action === 'needs_review').map((item) => <li key={item.title}>{item.title}</li>)}
            </ul>
          </div>}
        </div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={isWorking}>{t('cancel')}</Button>
          <Button type="button" onClick={() => void confirmImport()} disabled={isWorking || !targetConfirmed || !preview?.summary.willCreate}>
            {isWorking ? t('loading') : t('settings.dotImportConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
