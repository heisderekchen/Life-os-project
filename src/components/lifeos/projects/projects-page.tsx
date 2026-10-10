'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CircleAlert,
  FolderKanban,
  ListChecks,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateProject, useDeleteProject, useProjects, useUpdateProject } from '@/lib/api/hooks'
import { useTranslation } from '@/lib/i18n'
import type { Project } from '@/stores/task-store'

type ProjectRecord = Project & {
  archived?: boolean
  _count?: { tasks?: number }
}

type ProjectForm = Pick<Project, 'name' | 'description' | 'color' | 'status' | 'startDate' | 'endDate'>
type ProjectFilter = 'all' | 'active' | 'completed' | 'archived'

const defaultForm: ProjectForm = {
  name: '',
  description: '',
  color: '#6b7280',
  status: 'active',
  startDate: null,
  endDate: null,
}

const validStatuses: Project['status'][] = ['active', 'on-hold', 'completed', 'cancelled']

function projectForm(project?: ProjectRecord | null): ProjectForm {
  if (!project) return defaultForm
  return {
    name: project.name,
    description: project.description || '',
    color: /^#[0-9a-f]{6}$/i.test(project.color) ? project.color : defaultForm.color,
    status: validStatuses.includes(project.status) ? project.status : 'active',
    startDate: project.startDate || null,
    endDate: project.endDate || null,
  }
}

export function ProjectsPage() {
  const { t, language } = useTranslation()
  const projectsQuery = useProjects()
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectRecord | null>(null)
  const [form, setForm] = useState<ProjectForm>(defaultForm)
  const [formError, setFormError] = useState(false)
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null)
  const [deleteError, setDeleteError] = useState(false)
  const [actionError, setActionError] = useState(false)

  useEffect(() => {
    if (formOpen) setForm(projectForm(editing))
  }, [editing, formOpen])

  const projects = (projectsQuery.data || []) as ProjectRecord[]
  const visibleProjects = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return projects.filter((project) => {
      const archived = Boolean(project.archived)
      if (filter === 'archived' && !archived) return false
      if (filter === 'active' && (archived || project.status !== 'active')) return false
      if (filter === 'completed' && (archived || project.status !== 'completed')) return false
      if (filter === 'all' && archived) return false
      return !needle || `${project.name} ${project.description || ''}`.toLocaleLowerCase().includes(needle)
    })
  }, [filter, projects, search])

  const openCreate = () => {
    setEditing(null)
    setForm(defaultForm)
    setFormError(false)
    setFormOpen(true)
  }

  const openEdit = (project: ProjectRecord) => {
    setEditing(project)
    setForm(projectForm(project))
    setFormError(false)
    setFormOpen(true)
  }

  const saveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const payload = {
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
      icon: editing?.icon ?? null,
    }
    if (!payload.name) return
    setFormError(false)
    try {
      if (editing) await updateProject.mutateAsync({ id: editing.id, ...payload })
      else await createProject.mutateAsync(payload)
      setFormOpen(false)
      setEditing(null)
    } catch {
      setFormError(true)
    }
  }

  const toggleArchive = async (project: ProjectRecord) => {
    setActionError(false)
    try {
      await updateProject.mutateAsync({ id: project.id, archived: !project.archived })
    } catch {
      setActionError(true)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteError(false)
    try {
      await deleteProject.mutateAsync(deleting.id)
      setDeleting(null)
    } catch {
      setDeleteError(true)
    }
  }

  const filters: { id: ProjectFilter; label: string }[] = [
    { id: 'all', label: t('projects.all') },
    { id: 'active', label: t('projects.active') },
    { id: 'completed', label: t('projects.completed') },
    { id: 'archived', label: t('projects.archived') },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8" data-testid="projects-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            {t('nav.productivity')}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('projects.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">{t('projects.subtitle')}</p>
        </div>
        <Button onClick={openCreate} className="w-full shrink-0 gap-2 sm:w-auto">
          <Plus className="h-4 w-4" />
          {t('projects.create')}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1 sm:pb-0" role="tablist" aria-label={t('projects.title')}>
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${filter === item.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('projects.search')}
            aria-label={t('projects.search')}
            className="pl-9"
          />
        </div>
      </div>

      {actionError && <p role="alert" className="text-sm text-destructive">{t('projects.saveError')}</p>}

      {projectsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('loading')}>
          {[0, 1, 2].map((item) => <div key={item} className="h-48 animate-pulse rounded-xl border bg-muted/40" />)}
        </div>
      ) : projectsQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <CircleAlert className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{t('projects.loadError')}</p>
            <Button variant="outline" onClick={() => void projectsQuery.refetch()} className="gap-2">
              <RotateCw className="h-4 w-4" />{t('projects.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : visibleProjects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center px-5 py-12 text-center sm:py-16">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FolderKanban className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-semibold">{projects.length === 0 ? t('projects.emptyTitle') : t('projects.noResults')}</h2>
            {projects.length === 0 && <p className="mt-2 max-w-md text-sm text-muted-foreground">{t('projects.emptyDescription')}</p>}
            {projects.length === 0 && <Button onClick={openCreate} className="mt-5 gap-2"><Plus className="h-4 w-4" />{t('projects.createFirst')}</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
          {visibleProjects.map((project) => {
            const taskCount = project._count?.tasks ?? project.taskCount ?? 0
            const color = /^#[0-9a-f]{6}$/i.test(project.color) ? project.color : '#6b7280'
            const dateFormat = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' })
            const dateRange = project.startDate || project.endDate
              ? [project.startDate, project.endDate].filter(Boolean).map((date) => dateFormat.format(new Date(date!))).join(' – ')
              : null
            const archived = Boolean(project.archived)
            return (
              <Card key={project.id} className="group overflow-hidden border-l-[3px] transition-all hover:-translate-y-0.5 hover:shadow-md" style={{ borderLeftColor: color }}>
                <CardContent className="flex h-full flex-col p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/75">
                        <FolderKanban className="h-5 w-5" style={{ color }} />
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <h2 className="truncate font-semibold leading-5" title={project.name}>{project.name}</h2>
                        <Badge variant="secondary" className="mt-2 max-w-full truncate text-xs">
                          {archived ? t('projects.archived') : t(`projects.statuses.${project.status}`)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t('projects.actions.edit', { name: project.name })} onClick={() => openEdit(project)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t(archived ? 'projects.actions.unarchive' : 'projects.actions.archive', { name: project.name })} onClick={() => void toggleArchive(project)} disabled={updateProject.isPending}>
                        {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" aria-label={t('projects.actions.delete', { name: project.name })} onClick={() => { setDeleteError(false); setDeleting(project) }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-4 min-h-10 line-clamp-2 text-sm text-muted-foreground">{project.description || t('projects.noDescription')}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />{t('projects.taskCount', { count: taskCount })}</span>
                    {dateRange && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{dateRange}</span>}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('projects.edit') : t('projects.create')}</DialogTitle>
            <DialogDescription>{t('projects.subtitle')}</DialogDescription>
          </DialogHeader>
          <form id="project-form" onSubmit={saveProject} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="project-name" className="text-sm font-medium">{t('projects.name')}</label>
              <Input id="project-name" autoFocus required maxLength={180} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="space-y-2">
              <label htmlFor="project-description" className="text-sm font-medium">{t('projects.description')}</label>
              <Textarea id="project-description" rows={3} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="project-status" className="text-sm font-medium">{t('projects.status')}</label>
                <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as Project['status'] })}>
                  <SelectTrigger id="project-status" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {validStatuses.map((status) => <SelectItem key={status} value={status}>{t(`projects.statuses.${status}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label htmlFor="project-color" className="text-sm font-medium">{t('projects.color')}</label>
                <Input id="project-color" type="color" className="h-10 w-full cursor-pointer p-1" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><label htmlFor="project-start-date" className="text-sm font-medium">{t('projects.startDate')}</label><Input id="project-start-date" type="date" value={form.startDate || ''} onChange={(event) => setForm({ ...form, startDate: event.target.value || null })} /></div>
              <div className="space-y-2"><label htmlFor="project-end-date" className="text-sm font-medium">{t('projects.endDate')}</label><Input id="project-end-date" type="date" value={form.endDate || ''} onChange={(event) => setForm({ ...form, endDate: event.target.value || null })} /></div>
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{t('projects.saveError')}</p>}
          </form>
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
            <Button type="submit" form="project-form" disabled={createProject.isPending || updateProject.isPending || !form.name.trim()}>
              {(createProject.isPending || updateProject.isPending) && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? t('save') : t('projects.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('projects.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('projects.deleteDescription', { name: deleting?.name || '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{t('projects.deleteError')}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending}>{t('cancel')}</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleteProject.isPending}>
              {deleteProject.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {t('projects.deleteConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
