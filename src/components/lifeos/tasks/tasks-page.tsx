'use client'

import { uiText, useInterfaceLanguage } from '@/lib/i18n/interface-copy'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Plus,
  Search,
  List,
  LayoutGrid,
  Calendar,
  Flag,
  Trash2,
  Edit3,
  X,
  Filter,
  GripVertical,
  ChevronRight,
  ChevronLeft,
  Clock,
  AlertCircle,
  CheckSquare,
  LayoutTemplate,
  RefreshCw,
  Repeat,
  Check,
  MousePointer2,
  CalendarDays,
  Folder,
  Hash,
  Sparkles,
  Command,
  ChevronDown,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useTaskStore, type Task, type Project } from '@/stores/task-store'
import { useAppStore } from '@/stores/app-store'
import { useTranslation } from '@/lib/i18n'
import { showToast } from '@/lib/toast'
import { useTasks, useProjects, useCreateTask, useUpdateTask, useDeleteTask, useRecurringTaskSeries } from '@/lib/api/hooks'
import { useIsMobile } from '@/hooks/use-mobile'
import { AgentRunPanel } from '@/components/lifeos/tasks/agent-run-panel'
import { TaskDetailExtensions } from '@/components/lifeos/tasks/task-detail-extensions'
import { fetchTaskCard, type TaskCard } from '@/components/lifeos/tasks/task-card-panel'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useDndContext,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-500/10 text-red-600 dark:text-red-400 priority-glow-urgent',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 priority-glow-high',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 priority-glow-medium',
  low: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
}

const HANDOFF_MARKER = '[停点]'

function splitTaskDescription(description: string) {
  const markerIndex = description.lastIndexOf(HANDOFF_MARKER)
  if (markerIndex === -1) return { body: description, handoff: '' }
  return {
    body: description.slice(0, markerIndex).trim(),
    handoff: description.slice(markerIndex + HANDOFF_MARKER.length).trim(),
  }
}

function isOverdueOpenTask(task: Task) {
  if (!task.dueDate || (task.status !== 'todo' && task.status !== 'in-progress')) return false
  const due = new Date(task.dueDate)
  const today = new Date()
  due.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return due < today
}

export function TaskRunSignals({ task }: { task: Task }) {
  const { handoff } = splitTaskDescription(task.description)
  return (
    <div className="task-run-signals min-w-0 rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{uiText('Latest progress')}</p>
        <span className="shrink-0 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">{uiText('Life OS task')}</span>
      </div>
      <p className="mt-1.5 min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/80">
        {handoff || uiText('No progress has been recorded yet.')}
      </p>
    </div>
  )
}

const priorityBorderColors: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-amber-500',
  low: 'border-l-green-400',
}

const priorityStripColors: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-green-400',
}

const taskTemplates = [
  { title: 'Bug Fix', priority: 'high' as const, description: 'Fix the reported bug in...', status: 'todo' as const },
  { title: 'Feature Request', priority: 'medium' as const, description: 'Implement the new feature...', status: 'todo' as const },
  { title: 'Code Review', priority: 'medium' as const, description: 'Review pull request for...', status: 'todo' as const },
  { title: 'Meeting Prep', priority: 'low' as const, description: 'Prepare agenda for...', status: 'todo' as const },
  { title: 'Documentation', priority: 'low' as const, description: 'Write documentation for...', status: 'todo' as const },
  { title: 'Release', priority: 'high' as const, description: 'Prepare release version...', status: 'todo' as const },
]

const filterBadgeColors: Record<string, string> = {
  all: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  todo: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  'in-progress': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  done: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
}

// statusLabels moved inside component for i18n

function cn(...inputs: (string | undefined | false)[]) {
  return inputs.filter(Boolean).join(' ')
}

function taskDateInputValue(value: string | null | undefined) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

// Map API task to local Task type
function mapApiTask(apiTask: Record<string, unknown>): Task {
  const dueDate = apiTask.dueDate ? new Date(apiTask.dueDate as string).toISOString().split('T')[0] : null
  const startDate = apiTask.startDate ? String(apiTask.startDate) : null
  const completedAt = apiTask.completedAt ? new Date(apiTask.completedAt as string).toISOString() : null
  const tags = (apiTask.tags as Record<string, unknown>[])?.map((t: Record<string, unknown>) => {
    const tag = t.tag as Record<string, unknown>
    return tag?.name as string || ''
  }).filter(Boolean) || []

  return {
    id: apiTask.id as string,
    title: apiTask.title as string,
    description: (apiTask.description as string) || '',
    status: apiTask.status as Task['status'],
    priority: apiTask.priority as Task['priority'],
    dueDate,
    startDate,
    completedAt,
    estimatedMinutes: (apiTask.estimatedMinutes as number | null | undefined) ?? null,
    actualMinutes: (apiTask.actualMinutes as number | null | undefined) ?? null,
    projectId: (apiTask.projectId as string) || null,
    parentTaskId: (apiTask.parentTaskId as string) || null,
    recurrence: (apiTask.recurrence as string || null) as Task['recurrence'],
    recurrenceConfig: (apiTask.recurrenceConfig as string) || null,
    tags,
    createdAt: new Date(apiTask.createdAt as string).toISOString(),
    updatedAt: new Date(apiTask.updatedAt as string).toISOString(),
  }
}

function mapApiProject(apiProject: Record<string, unknown>): Project {
  return {
    id: apiProject.id as string,
    name: apiProject.name as string,
    description: (apiProject.description as string) || '',
    color: (apiProject.color as string) || '#6b7280',
    icon: (apiProject.icon as string) || null,
    status: ((apiProject.status as string) || 'active') as Project['status'],
    startDate: apiProject.startDate ? new Date(apiProject.startDate as string).toISOString().split('T')[0] : null,
    endDate: apiProject.endDate ? new Date(apiProject.endDate as string).toISOString().split('T')[0] : null,
    taskCount: 0,
    completedCount: 0,
    createdAt: new Date(apiProject.createdAt as string).toISOString(),
    updatedAt: new Date(apiProject.updatedAt as string).toISOString(),
  }
}

function getDueDateStatus(dueDate: string | null) {
  if (!dueDate) return { label: '', className: '' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { label: 'Overdue', className: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800' }
  if (diffDays === 0) return { label: 'Due today', className: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800' }
  if (diffDays === 1) return { label: 'Tomorrow', className: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800' }
  return { label: dueDate, className: 'text-muted-foreground' }
}

// Sortable Task Card Component
function SortableTaskCard({
  task,
  projectName,
  selectedTaskId,
  celebratingTaskId,
  onSelectTask,
  onMoveTask,
  onDeleteTask,
  onEditTask,
  columnStatus,
}: {
  task: Task
  projectName?: string
  selectedTaskId: string | null
  celebratingTaskId: string | null
  onSelectTask: (id: string) => void
  onMoveTask: (id: string, status: Task['status']) => void
  onDeleteTask: (id: string) => void
  onEditTask?: (task: Task) => void
  columnStatus: Task['status']
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { status: columnStatus } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    scale: isDragging ? 1.03 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  const dueStatus = getDueDateStatus(task.dueDate)
  const isCelebrating = celebratingTaskId === task.id

  const { t } = useTranslation()

  return (
    <div ref={setNodeRef} style={style}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <Card
        className={cn(
          'cursor-pointer transition-all duration-200 border-l-[3px] hover:shadow-md micro-hover shadow-card',
          priorityBorderColors[task.priority],
          selectedTaskId === task.id ? 'ring-2 ring-primary/20 shadow-md' : '',
          isCelebrating && 'animate-celebrate',
          isDragging && 'shadow-xl ring-2 ring-primary/30 rotate-1'
        )}
        onClick={() => onSelectTask(task.id)}
        onDoubleClick={(e) => { e.stopPropagation(); onEditTask?.(task) }}
      >
        <CardContent className="space-y-3 p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 flex-1 min-w-0">
              <div {...attributes} {...listeners} aria-label={uiText('Drag task')} className="mt-0.5 cursor-grab active:cursor-grabbing touch-none">
                <GripVertical className="h-4 w-4 text-muted-foreground/30 shrink-0 hover:text-muted-foreground/60 transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-[15px] font-semibold leading-snug break-words', task.status === 'done' && 'line-through-animate text-muted-foreground')}>
                  {task.title}
                </p>
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 pl-7">
            <Badge className={cn(`${priorityColors[task.priority]} rounded-full border-0 px-2 py-0.5 text-[10px] font-semibold`, task.priority === 'urgent' && 'animate-pulse-urgent')}>
              {t(`tasks.${task.priority}`)}
            </Badge>
            <Badge variant="outline" className="rounded-full text-[10px]">{task.status === 'in-progress' ? t('tasks.inProgress') : task.status === 'todo' ? t('tasks.todo') : t('tasks.done')}</Badge>
            {projectName && <Badge variant="secondary" className="max-w-full truncate rounded-full text-[10px]">{projectName}</Badge>}
            {task.dueDate && <Badge variant="outline" className={cn('rounded-full text-[10px]', dueStatus.className)}><Clock className="mr-1 h-2.5 w-2.5" />{uiText(dueStatus.label) || task.dueDate}</Badge>}
          </div>
          {splitTaskDescription(task.description).body && (
            <p className="line-clamp-2 pl-7 text-xs leading-relaxed text-muted-foreground">{splitTaskDescription(task.description).body}</p>
          )}
          {(splitTaskDescription(task.description).handoff || task.description) && <p className="line-clamp-2 pl-7 text-xs leading-relaxed text-muted-foreground">{splitTaskDescription(task.description).handoff || splitTaskDescription(task.description).body}</p>}
          <div className="flex items-center justify-end gap-0.5 border-t border-border/50 pl-7 pt-2">
            <div className="flex items-center gap-0.5">
              {columnStatus !== 'todo' && (
                <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-accent" onClick={(e) => { e.stopPropagation(); onMoveTask(task.id, columnStatus === 'in-progress' ? 'todo' : 'in-progress') }}>
                  <ChevronLeft className="h-3 w-3" />
                </Button>
              )}
              {columnStatus !== 'done' && (
                <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-accent" onClick={(e) => { e.stopPropagation(); onMoveTask(task.id, columnStatus === 'todo' ? 'in-progress' : 'done') }}>
                  <ChevronRight className="h-3 w-3" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-accent hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id) }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-7">
              {task.tags.slice(0, 3).map(tag => (
                <Badge key={tag} variant="secondary" className="text-[10px] px-1.5">{tag}</Badge>
              ))}
              {task.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{task.tags.length - 3}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => onEditTask?.(task)}>
            <Edit3 className="h-3.5 w-3.5 mr-2" />
            {t('edit')}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ChevronRight className="h-3.5 w-3.5 mr-2" />
              {t('tasks.moveTo')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-36">
              <ContextMenuItem disabled={columnStatus === 'todo'} onClick={() => onMoveTask(task.id, 'todo')}>
                {t('tasks.todo')}
              </ContextMenuItem>
              <ContextMenuItem disabled={columnStatus === 'in-progress'} onClick={() => onMoveTask(task.id, 'in-progress')}>
                {t('tasks.inProgress')}
              </ContextMenuItem>
              <ContextMenuItem disabled={columnStatus === 'done'} onClick={() => onMoveTask(task.id, 'done')}>
                {t('tasks.done')}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onDeleteTask(task.id)} className="text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            {t('delete')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

// Drop zone column component that detects drag-over
function DroppableColumn({
  status,
  isOver,
  children,
  className,
}: {
  status: Task['status']
  isOver: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        className,
        isOver && 'ring-2 ring-primary/40 ring-offset-1 bg-primary/5'
      )}
      data-column-status={status}
    >
      {children}
    </div>
  )
}

const accentHexMap: Record<string, string> = {
  emerald: '#10b981', teal: '#14b8a6', amber: '#f59e0b',
  rose: '#f43f5e', violet: '#8b5cf6', cyan: '#06b6d4',
  indigo: '#6366f1', pink: '#ec4899', lime: '#84cc16', sky: '#0ea5e9',
}

export function TasksPage() {
  useInterfaceLanguage()
  const { taskView, setTaskView, taskFilter, setTaskFilter } = useTaskStore()
  const [queueFilter, setQueueFilter] = useState<'all' | 'in-progress' | 'attention' | 'todo'>('all')
  const accentColor = useAppStore((s) => s.accentColor)
  const { t } = useTranslation()
  const statusLabels: Record<string, string> = useMemo(() => ({
    'todo': t('tasks.todo'),
    'in-progress': t('tasks.inProgress'),
    'done': t('tasks.done'),
    'cancelled': uiText('Cancelled'),
  }), [t])
  const accentHex = accentHexMap[accentColor] || '#10b981'
  const { data: apiTasks, isLoading } = useTasks()
  const { data: apiProjects } = useProjects()
  const createTaskMutation = useCreateTask()
  const updateTaskMutation = useUpdateTask()
  const deleteTaskMutation = useDeleteTask()

  const tasks: Task[] = useMemo(() => {
    if (!apiTasks) return []
    return (apiTasks as Record<string, unknown>[]).map(mapApiTask)
  }, [apiTasks])

  const projects: Project[] = useMemo(() => {
    if (!apiProjects) return []
    return (apiProjects as Record<string, unknown>[]).map(mapApiProject)
  }, [apiProjects])
  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects])
  const recurringTasksQuery = useRecurringTaskSeries()

  const [searchQuery, setSearchQuery] = useState('')
  const [taskSection, setTaskSection] = useState<'mine' | 'recurring'>('mine')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedTaskCard, setSelectedTaskCard] = useState<TaskCard | null>(null)
  const [taskCardLoadState, setTaskCardLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [taskWorkspaceMode, setTaskWorkspaceMode] = useState<'detail' | 'edit'>('detail')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium' as Task['priority'], dueDate: '', projectId: '', tags: '', recurrence: 'none' as Task['recurrence'] })
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Edit-task dialog state — populated when the user clicks "Edit" in the
  // context menu or double-clicks a task title.
  const [editTask, setEditTask] = useState<Pick<Task, 'id' | 'title' | 'description' | 'priority' | 'dueDate' | 'startDate' | 'projectId' | 'status' | 'recurrence' | 'recurrenceConfig' | 'estimatedMinutes' | 'actualMinutes'> & { tags: string[]; tagInput: string } | null>(null)
  const [handoffDraft, setHandoffDraft] = useState('')
  const isMobile = useIsMobile()
  const previousSelectedTaskId = useRef<string | null>(null)

  const selectedTask = useMemo(() => tasks.find(t => t.id === selectedTaskId), [tasks, selectedTaskId])

  const taskEditHasChanges = useCallback(() => Boolean(editTask && selectedTask && (
    editTask.title !== selectedTask.title
    || editTask.description !== selectedTask.description
    || editTask.priority !== selectedTask.priority
    || editTask.status !== selectedTask.status
    || taskDateInputValue(editTask.dueDate) !== taskDateInputValue(selectedTask.dueDate)
    || taskDateInputValue(editTask.startDate) !== taskDateInputValue(selectedTask.startDate)
    || editTask.projectId !== (selectedTask.projectId || '')
    || editTask.recurrence !== (selectedTask.recurrence || 'none')
    || editTask.recurrenceConfig !== (selectedTask.recurrenceConfig || '')
    || editTask.estimatedMinutes !== selectedTask.estimatedMinutes
    || editTask.actualMinutes !== selectedTask.actualMinutes
    || !sameStrings(editTask.tags, selectedTask.tags)
    || editTask.tagInput.trim().length > 0
  )), [editTask, selectedTask])

  const loadSelectedTaskCard = useCallback(async (taskId: string) => {
    setTaskCardLoadState('loading')
    try {
      setSelectedTaskCard(await fetchTaskCard(taskId))
      setTaskCardLoadState('ready')
    } catch {
      setSelectedTaskCard(null)
      setTaskCardLoadState('error')
    }
  }, [])

  useEffect(() => {
    if (selectedTaskId) void loadSelectedTaskCard(selectedTaskId)
    else { setSelectedTaskCard(null); setTaskCardLoadState('loading') }
  }, [selectedTaskId, loadSelectedTaskCard])

  useEffect(() => {
    const previousId = previousSelectedTaskId.current
    previousSelectedTaskId.current = selectedTaskId
    if (selectedTaskId || !previousId) return
    requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('[data-task-id]')].find(element => element.dataset.taskId === previousId)?.focus({ preventScroll: true }))
  }, [selectedTaskId])

  useEffect(() => {
    setHandoffDraft(selectedTask ? splitTaskDescription(selectedTask.description).handoff : '')
  }, [selectedTask?.id, selectedTask?.description])

  useEffect(() => {
    if (taskWorkspaceMode !== 'edit') return
    const handleModuleChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      if (taskEditHasChanges() && !window.confirm('放弃尚未保存的修改？')) event.preventDefault()
    }
    window.addEventListener('lifeos:before-module-change', handleModuleChange)
    return () => window.removeEventListener('lifeos:before-module-change', handleModuleChange)
  }, [taskWorkspaceMode, taskEditHasChanges])

  const filteredTasks = useMemo(() => {
    let result = tasks
    if (queueFilter === 'attention') {
      result = result.filter(isOverdueOpenTask)
    } else if (queueFilter !== 'all') {
      result = result.filter(t => t.status === queueFilter && !isOverdueOpenTask(t))
    } else if (taskFilter !== 'all') {
      result = result.filter(t => t.status === taskFilter)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    }
    return result
  }, [tasks, taskFilter, queueFilter, searchQuery])

  const todoTasks = filteredTasks.filter(t => t.status === 'todo')
  const inProgressTasks = filteredTasks.filter(t => t.status === 'in-progress')
  const doneTasks = filteredTasks.filter(t => t.status === 'done')

  const overdueTasks = tasks.filter(t => {
    return isOverdueOpenTask(t)
  })

  const handleAddTask = useCallback(() => {
    if (!newTask.title.trim()) return
    createTaskMutation.mutate({
      title: newTask.title,
      description: newTask.description,
      status: 'todo',
      priority: newTask.priority,
      dueDate: newTask.dueDate || null,
      projectId: newTask.projectId || null,
      recurrence: newTask.recurrence !== 'none' ? newTask.recurrence : null,
      tags: newTask.tags.split(',').map(tag => tag.trim()).filter(Boolean),
    }, {
      onSuccess: () => {
        setNewTask({ title: '', description: '', priority: 'medium', dueDate: '', projectId: '', tags: '', recurrence: 'none' })
        setCreateDialogOpen(false)
        showToast.success(uiText("Task created"), uiText("New task has been added"))
      }
    })
  }, [newTask, createTaskMutation])

  const handleTemplateSelect = useCallback((template: typeof taskTemplates[number]) => {
    createTaskMutation.mutate({
      title: template.title,
      description: template.description,
      status: template.status,
      priority: template.priority,
      dueDate: null,
      projectId: null,
    }, {
      onSuccess: () => {
        showToast.success(uiText("Task created from template"), `"${template.title}" ${uiText("task added")}`)
      }
    })
  }, [createTaskMutation])

  const [celebratingTaskId, setCelebratingTaskId] = useState<string | null>(null)

  const toggleTaskStatus = useCallback((id: string) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    updateTaskMutation.mutate({ id, status: newStatus })
    if (newStatus === 'done') {
      setCelebratingTaskId(id)
      setTimeout(() => setCelebratingTaskId(null), 500)
      showToast.success(uiText("Task updated"), uiText("Task marked as done 🎉"))
    }
  }, [tasks, updateTaskMutation])

  const deleteTask = useCallback((id: string) => {
    deleteTaskMutation.mutate(id)
    if (selectedTaskId === id) setSelectedTaskId(null)
    showToast.info(uiText("Task deleted"), uiText("Task has been removed"))
  }, [deleteTaskMutation, selectedTaskId])

  const moveTask = useCallback((id: string, newStatus: Task['status']) => {
    updateTaskMutation.mutate({ id, status: newStatus })
  }, [updateTaskMutation])

  const openTaskWorkspace = useCallback((id: string) => {
    setEditTask(null)
    setTaskWorkspaceMode('detail')
    setSelectedTaskId(id)
  }, [])

  // Open the shared task workspace directly in edit mode.
  const openEditDialog = useCallback((task: Task) => {
    setEditTask({
      id: task.id,
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      dueDate: task.dueDate || '',
      startDate: task.startDate || '',
      projectId: task.projectId || '',
      status: task.status,
      recurrence: task.recurrence || 'none',
      recurrenceConfig: task.recurrenceConfig || '',
      estimatedMinutes: task.estimatedMinutes,
      actualMinutes: task.actualMinutes,
      tags: [...task.tags],
      tagInput: '',
    })
    setSelectedTaskId(task.id)
    setTaskWorkspaceMode('edit')
  }, [])

  const handleUpdateTask = useCallback(() => {
    if (!editTask || !selectedTask || !editTask.title.trim()) return
    const patch: { id: string } & Record<string, unknown> = { id: editTask.id }
    if (editTask.title !== selectedTask.title) patch.title = editTask.title
    if (editTask.description !== selectedTask.description) patch.description = editTask.description
    if (editTask.priority !== selectedTask.priority) patch.priority = editTask.priority
    if (taskDateInputValue(editTask.dueDate) !== taskDateInputValue(selectedTask.dueDate)) patch.dueDate = taskDateInputValue(editTask.dueDate) || null
    if (taskDateInputValue(editTask.startDate) !== taskDateInputValue(selectedTask.startDate)) patch.startDate = taskDateInputValue(editTask.startDate) || null
    if ((editTask.projectId || null) !== (selectedTask.projectId || null)) patch.projectId = editTask.projectId || null
    if (editTask.status !== selectedTask.status) patch.status = editTask.status
    const recurrence = editTask.recurrence !== 'none' ? editTask.recurrence : null
    if (recurrence !== selectedTask.recurrence) patch.recurrence = recurrence
    const recurrenceConfig = editTask.recurrenceConfig || null
    if (recurrenceConfig !== selectedTask.recurrenceConfig) patch.recurrenceConfig = recurrenceConfig
    if (editTask.estimatedMinutes !== selectedTask.estimatedMinutes) patch.estimatedMinutes = editTask.estimatedMinutes
    if (editTask.actualMinutes !== selectedTask.actualMinutes) patch.actualMinutes = editTask.actualMinutes
    if (!sameStrings(editTask.tags, selectedTask.tags)) patch.tags = editTask.tags
    if (Object.keys(patch).length === 1) {
      setTaskWorkspaceMode('detail')
      setEditTask(null)
      return
    }
    updateTaskMutation.mutate(patch, {
      onSuccess: () => {
        setTaskWorkspaceMode('detail')
        setEditTask(null)
        showToast.success(t('toast.saved'))
      },
    })
  }, [editTask, selectedTask, updateTaskMutation, t])

  const closeTaskWorkspace = useCallback(() => {
    setSelectedTaskId(null)
    setTaskWorkspaceMode('detail')
    setEditTask(null)
  }, [])

  const handleTaskWorkspaceOpenChange = useCallback((open: boolean) => {
    if (open) return
    if (taskWorkspaceMode === 'edit' && taskEditHasChanges() && !window.confirm('放弃尚未保存的修改？')) return
    closeTaskWorkspace()
  }, [taskWorkspaceMode, taskEditHasChanges, closeTaskWorkspace])

  const saveTaskHandoff = useCallback(() => {
    if (!selectedTask || !handoffDraft.trim()) return
    const { body } = splitTaskDescription(selectedTask.description)
    updateTaskMutation.mutate(
      { id: selectedTask.id, description: `${body}${body ? '\n\n' : ''}${HANDOFF_MARKER}\n${handoffDraft.trim()}` },
      {
        onSuccess: () => showToast.success('停点已保存', '下次打开此任务会直接显示下一步'),
        onError: () => showToast.error('保存失败', '请稍后重试'),
      },
    )
  }, [selectedTask, handoffDraft, updateTaskMutation])

  const handleBulkDone = useCallback(() => {
    selectedIds.forEach(id => {
      updateTaskMutation.mutate({ id, status: 'done' })
    })
    showToast.success(`${selectedIds.size} görev tamamlandı`, '')
    setSelectedIds(new Set())
    setSelectionMode(false)
  }, [selectedIds, updateTaskMutation])

  const handleBulkDelete = useCallback(() => {
    if (!confirm(`${selectedIds.size} görevi silmek istediğinizden emin misiniz?`)) return
    selectedIds.forEach(id => {
      deleteTaskMutation.mutate(id)
      if (selectedTaskId === id) setSelectedTaskId(null)
    })
    showToast.info(`${selectedIds.size} görev silindi`, '')
    setSelectedIds(new Set())
    setSelectionMode(false)
  }, [selectedIds, deleteTaskMutation, selectedTaskId])

  const toggleSelectId = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const [newSubtask, setNewSubtask] = useState('')

  const handleAddSubtask = useCallback(() => {
    if (!newSubtask.trim() || !selectedTaskId) return
    createTaskMutation.mutate({
      title: newSubtask.trim(),
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      projectId: null,
      parentTaskId: selectedTaskId,
    }, {
      onSuccess: () => {
        setNewSubtask('')
        showToast.success(uiText("Alt görev eklendi"), '')
      }
    })
  }, [newSubtask, selectedTaskId, createTaskMutation])

  const cancelTaskEdit = useCallback(() => {
    if (taskEditHasChanges() && !window.confirm('放弃尚未保存的修改？')) return
    setTaskWorkspaceMode('detail')
    setEditTask(null)
  }, [taskEditHasChanges])

  const taskDetailContent = selectedTask ? (
    <div className="space-y-5">
      <div className="flex flex-col gap-5 border-b border-border/60 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><p className="mb-2 break-all text-xs font-medium tracking-wide text-muted-foreground">任务编号 · {selectedTask.id}</p><h3 className="max-w-4xl break-words text-2xl font-semibold tracking-tight text-pretty sm:text-3xl">{selectedTask.title}</h3></div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => openEditDialog(selectedTask)}><Edit3 className="mr-2 h-3.5 w-3.5" />{t('edit')}</Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-7 sm:w-7 shrink-0" aria-label="返回任务列表" onClick={closeTaskWorkspace}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={`${priorityColors[selectedTask.priority]} text-xs rounded-full border-0`}>{t(`tasks.${selectedTask.priority}`)}</Badge>
        <Badge className={cn('text-xs rounded-full border-0', selectedTask.status === 'done' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : selectedTask.status === 'in-progress' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-slate-500/10 text-slate-600 dark:text-slate-400')}>{selectedTask.status === 'in-progress' ? t('tasks.inProgress') : selectedTask.status === 'todo' ? t('tasks.todo') : t('tasks.done')}</Badge>
        {selectedTask.dueDate && (
          <Badge variant="outline" className={cn('text-xs', getDueDateStatus(selectedTask.dueDate).className)}>
            <Calendar className="h-3 w-3 mr-1" />{selectedTask.dueDate}
          </Badge>
        )}
      </div>
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
      <div className="min-w-0 space-y-5">
      <section className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold">任务目标</p>
        {taskCardLoadState === 'loading' ? <p className="text-sm text-muted-foreground">正在读取任务卡…</p>
          : taskCardLoadState === 'error' ? <div className="flex items-center gap-3"><p role="alert" className="text-sm text-muted-foreground">任务目标读取失败。</p><Button variant="outline" size="sm" onClick={() => void loadSelectedTaskCard(selectedTask.id)}>重试</Button></div>
          : selectedTaskCard?.goal ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{selectedTaskCard.goal}</p>
            : <p className="text-sm text-muted-foreground">尚未填写任务目标。</p>}
      </section>
      <section className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold">预期产出与验收</p>
        {taskCardLoadState === 'loading' ? <p className="text-sm text-muted-foreground">正在读取预期产出与验收…</p>
          : taskCardLoadState === 'error' ? <p className="text-sm text-muted-foreground">无法读取任务卡字段，请使用目标区域的重试按钮。</p>
            : <>
              <div><p className="mb-1 text-xs text-muted-foreground">预期产出</p>{selectedTaskCard?.expectedArtifacts.length ? <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">{selectedTaskCard.expectedArtifacts.map((item, index) => <li key={`${index}-${item}`} className="break-words">{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">尚未填写预期产出。</p>}</div>
              <div><p className="mb-1 text-xs text-muted-foreground">验收标准</p>{selectedTaskCard?.verification.length ? <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">{selectedTaskCard.verification.map((item, index) => <li key={`${index}-${item}`} className="break-words">{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">尚未填写验收标准。</p>}</div>
              {selectedTaskCard?.nextStep && <div><p className="mb-1 text-xs text-muted-foreground">下一步</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{selectedTaskCard.nextStep}</p></div>}
            </>}
      </section>
      <section className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-card p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{uiText('Task materials')}</p>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {selectedTask.projectId && projectNames.get(selectedTask.projectId) && <Badge variant="secondary" className="max-w-full truncate">{projectNames.get(selectedTask.projectId)}</Badge>}
          {selectedTask.tags.map(tag => <Badge key={tag} variant="outline" className="max-w-full truncate">#{tag}</Badge>)}
          {selectedTask.recurrence && selectedTask.recurrence !== 'none' && <Badge variant="outline" className="capitalize">{selectedTask.recurrence}</Badge>}
          {selectedTask.estimatedMinutes && <Badge variant="outline">{t('tasks.estimated')}: {selectedTask.estimatedMinutes} {t('tasks.min')}</Badge>}
        </div>
      </section>
      </div>
      <div className="min-w-0 space-y-5">
      <section className="space-y-2 rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">停点与下一步</p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{handoffDraft ? '当前进度与下一步可在这里继续更新。' : '添加一条进展或下一步，之后可以从这里接着做。'}</p>
        <Textarea value={handoffDraft} onChange={(event) => setHandoffDraft(event.target.value)} placeholder="例如：已整理完资料，下一步是确认报价并发给客户。" className="min-h-20 resize-none text-sm" />
        <Button size="sm" className="w-full" onClick={saveTaskHandoff} disabled={!handoffDraft.trim() || updateTaskMutation.isPending}>
          {updateTaskMutation.isPending ? '正在保存…' : '保存停点'}
        </Button>
      </section>
      <section className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
        <p className="text-sm font-medium">{uiText("Alt Görevler")}</p>
        {tasks.filter(t => t.parentTaskId === selectedTask.id).map(sub => (
          <div key={sub.id} className="flex items-center gap-2">
            <Checkbox
              checked={sub.status === 'done'}
              onCheckedChange={() => toggleTaskStatus(sub.id)}
            />
            <span className={cn('text-sm flex-1', sub.status === 'done' && 'line-through text-muted-foreground')}>{sub.title}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => deleteTask(sub.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-1">
          <Input
            placeholder={uiText("Alt görev ekle...")}
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtask() }}
            className="h-11 text-base"
          />
          <Button size="icon" variant="outline" className="h-11 w-11 shrink-0" onClick={handleAddSubtask} disabled={createTaskMutation.isPending} aria-label={uiText('Add subtask')}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </section>
      </div>
      </div>
      <div className="space-y-5">
      <AgentRunPanel task={{ id: selectedTask.id, title: selectedTask.title, description: splitTaskDescription(selectedTask.description).body }} />
      <TaskDetailExtensions taskId={selectedTask.id} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <Button variant="outline" size="sm" onClick={() => toggleTaskStatus(selectedTask.id)}>
          {selectedTask.status === 'done' ? t('tasks.markIncomplete') : t('tasks.markComplete')}
        </Button>
        <details className="group relative">
          <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-destructive">更多操作</summary>
          <div className="absolute bottom-full right-0 z-10 mb-2 rounded-lg border border-border bg-popover p-1 shadow-lg">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { if (window.confirm('确定删除这个任务吗？')) deleteTask(selectedTask.id) }}><Trash2 className="mr-1.5 h-3.5 w-3.5" />{t('tasks.deleteTask')}</Button>
          </div>
        </details>
      </div>
    </div>
  ) : null

  const taskEditContent = editTask ? (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 pb-6 pt-5 sm:space-y-7 sm:px-8 sm:py-8">
      <div className="flex min-w-0 flex-col items-start justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center">
        <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{uiText('Task workspace')}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{t('tasks.editTask')}</h2><p className="mt-1 max-w-full break-words text-sm text-muted-foreground">{editTask.title || t('tasks.taskTitle')}</p></div>
      </div>
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-5" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleUpdateTask() } }}>
          <div><label className="mb-2 block text-sm font-medium">{t('tasks.taskTitle')}</label><Input aria-label={t('tasks.taskTitle')} autoFocus={!isMobile} className="h-12 text-base" value={editTask.title} onChange={(e) => setEditTask((p) => p && ({ ...p, title: e.target.value }))} /></div>
          <div><label className="mb-2 block text-sm font-medium">{t('tasks.description')}</label><Textarea rows={8} className="resize-y text-base leading-6" value={editTask.description} onChange={(e) => setEditTask((p) => p && ({ ...p, description: e.target.value }))} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="mb-2 block text-sm font-medium">{t('tasks.priority')}</label><Select value={editTask.priority} onValueChange={(v) => setEditTask((p) => p && ({ ...p, priority: v as Task['priority'] }))}><SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">{t('tasks.low')}</SelectItem><SelectItem value="medium">{t('tasks.medium')}</SelectItem><SelectItem value="high">{t('tasks.high')}</SelectItem><SelectItem value="urgent">{t('tasks.urgent')}</SelectItem></SelectContent></Select></div>
            <div><label className="mb-2 block text-sm font-medium">{t('tasks.status')}</label><Select value={editTask.status} onValueChange={(v) => setEditTask((p) => p && ({ ...p, status: v as Task['status'] }))}><SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todo">{t('tasks.todo')}</SelectItem><SelectItem value="in-progress">{t('tasks.inProgress')}</SelectItem><SelectItem value="done">{t('tasks.done')}</SelectItem></SelectContent></Select></div>
            <div><label className="mb-2 block text-sm font-medium">{uiText('Start date')}</label><Input className="h-11 text-base" type="date" value={taskDateInputValue(editTask.startDate)} onChange={(e) => setEditTask((p) => p && ({ ...p, startDate: e.target.value }))} /></div>
            <div><label className="mb-2 block text-sm font-medium">{t('tasks.dueDate')}</label><Input className="h-11 text-base" type="date" value={taskDateInputValue(editTask.dueDate)} onChange={(e) => setEditTask((p) => p && ({ ...p, dueDate: e.target.value }))} /></div>
            <div><label className="mb-2 block text-sm font-medium">{t('tasks.project')}</label><Select value={editTask.projectId || 'none'} onValueChange={(v) => setEditTask((p) => p && ({ ...p, projectId: v === 'none' ? '' : v }))}><SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem>{projects.map((pr) => <SelectItem key={pr.id} value={pr.id}>{pr.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="mb-2 block text-sm font-medium">{uiText('Estimated minutes')}</label><Input className="h-11 text-base" type="number" min="0" value={editTask.estimatedMinutes ?? ''} onChange={(e) => setEditTask((p) => p && ({ ...p, estimatedMinutes: e.target.value ? Number(e.target.value) : null }))} /></div>
            <div><label className="mb-2 block text-sm font-medium">{uiText('Actual minutes')}</label><Input className="h-11 text-base" type="number" min="0" value={editTask.actualMinutes ?? ''} onChange={(e) => setEditTask((p) => p && ({ ...p, actualMinutes: e.target.value ? Number(e.target.value) : null }))} /></div>
          </div>
          <div><label className="mb-2 block text-sm font-medium">{t('tasks.composer.recurrence')}</label><Select value={editTask.recurrence || 'none'} onValueChange={(v) => setEditTask((p) => p && ({ ...p, recurrence: v as Task['recurrence'] }))}><SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t('tasks.composer.recurrenceNone')}</SelectItem><SelectItem value="daily">{t('habits.daily')}</SelectItem><SelectItem value="weekly">{t('habits.weekly')}</SelectItem><SelectItem value="monthly">{t('habits.monthly')}</SelectItem></SelectContent></Select></div>
          {editTask.recurrence !== 'none' && <div><label className="mb-2 block text-sm font-medium">{uiText('Recurrence details')}</label><Input className="h-11 text-base" value={editTask.recurrenceConfig || ''} onChange={(e) => setEditTask((p) => p && ({ ...p, recurrenceConfig: e.target.value }))} placeholder={uiText('Optional recurrence configuration')} /></div>}
          <div>
            <label className="mb-2 block text-sm font-medium">{uiText('Tags')}</label>
            <div className="flex gap-2">
              <Input aria-label={uiText('Add tag')} className="h-11 text-base" value={editTask.tagInput} onChange={(e) => setEditTask((p) => p && ({ ...p, tagInput: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const value = editTask.tagInput.trim(); if (value && !editTask.tags.includes(value)) setEditTask((p) => p && ({ ...p, tags: [...p.tags, value], tagInput: '' })) } }} placeholder={uiText('Add a tag')} />
              <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => { const value = editTask.tagInput.trim(); if (value && !editTask.tags.includes(value)) setEditTask((p) => p && ({ ...p, tags: [...p.tags, value], tagInput: '' })) }}>{uiText('Add')}</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">{editTask.tags.map((tag, index) => <Badge key={`${index}-${tag}`} variant="secondary" className="gap-1.5 py-1">{tag}<button type="button" aria-label={`${uiText('Remove tag')} ${tag}`} onClick={() => setEditTask((p) => p && ({ ...p, tags: p.tags.filter((_, currentIndex) => currentIndex !== index) }))} className="rounded-full hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">×</button></Badge>)}</div>
          </div>
        </div>
        <aside className="h-fit rounded-xl border border-border/60 bg-muted/20 p-4"><h3 className="text-sm font-semibold">{uiText('Task essentials')}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{uiText('Set the task goal, timing, owner project and current status. Existing execution, subtasks and knowledge links stay attached.')}</p><div className="mt-4 space-y-3 text-xs"><p><span className="text-muted-foreground">{t('tasks.status')}</span><br /><span className="font-medium">{statusLabels[editTask.status]}</span></p><p><span className="text-muted-foreground">{t('tasks.project')}</span><br /><span className="font-medium">{editTask.projectId ? projectNames.get(editTask.projectId) : '—'}</span></p></div></aside>
      </div>
    </div>
  ) : null

  return (
    <div className="flex h-full min-h-0">
      {/* Main Content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">

        <div role="group" aria-label={uiText('Task queue')} className="shrink-0 px-2 pt-2 sm:px-4 sm:pt-4">
          <div className="mb-1.5 flex items-baseline justify-between sm:mb-2">
            <h2 className="text-sm font-semibold">{uiText('Your work')}</h2>
            <span className="text-xs text-muted-foreground">{tasks.length} {uiText('tasks in view')}</span>
          </div>
          <div className="grid grid-cols-4 divide-x divide-border/70 overflow-hidden border-y border-border/70">
            {([
              { id: 'in-progress', label: uiText('In progress'), mobileLabel: uiText('Active'), count: tasks.filter(task => task.status === 'in-progress' && !isOverdueOpenTask(task)).length, note: uiText('Being worked on') },
              { id: 'attention', label: uiText('Needs attention'), mobileLabel: uiText('Overdue'), count: overdueTasks.length, note: uiText('Overdue') },
              { id: 'all', label: uiText('All tasks'), mobileLabel: uiText('All'), count: tasks.length, note: uiText('Every status') },
              { id: 'todo', label: uiText('Next up'), mobileLabel: uiText('Next'), count: tasks.filter(task => task.status === 'todo' && !isOverdueOpenTask(task)).length, note: uiText('Ready to start') },
            ] as const).map((queue) => {
              const selected = queueFilter === queue.id && taskFilter === 'all'
              return (
                <button key={queue.id} type="button" aria-label={`${queue.label}: ${queue.count}`} aria-pressed={selected} onClick={() => { setQueueFilter(queue.id); setTaskFilter('all') }} className={cn('flex min-h-11 flex-col justify-center gap-0.5 px-1.5 py-1 text-center transition-colors hover:bg-accent/40 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-[76px] sm:items-stretch sm:gap-0 sm:px-4 sm:py-3 sm:text-left', selected && 'bg-accent/45')}>
                  <span className="flex min-w-0 flex-col items-center justify-center gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                    <span className="text-xs font-semibold leading-tight sm:truncate sm:text-sm"><span className="sm:hidden">{queue.mobileLabel}</span><span className="hidden sm:inline">{queue.label}</span></span>
                    <span className="text-xs font-semibold tabular-nums sm:text-lg">{queue.count}</span>
                  </span>
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:mt-1 sm:block">{queue.note}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="shrink-0 border-b border-border/50 px-2 pt-1.5 sm:px-4 sm:pt-3">
          <Tabs value={taskSection} onValueChange={(value) => setTaskSection(value as 'mine' | 'recurring')}>
            <TabsList className="h-10 w-full justify-start rounded-none bg-transparent p-0 sm:h-11">
              <TabsTrigger value="mine" className="h-10 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-primary sm:h-11 sm:px-4 sm:text-sm">{uiText('My tasks')}</TabsTrigger>
              <TabsTrigger value="recurring" className="h-10 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-primary sm:h-11 sm:px-4 sm:text-sm"><Repeat className="mr-1.5 h-4 w-4 sm:mr-2" />{uiText('Recurring tasks')} <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums sm:ml-2 sm:px-2 sm:text-xs">{recurringTasksQuery.data?.activeCount ?? '—'}</span></TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Toolbar */}
        {taskSection === 'mine' && <div className="shrink-0 space-y-2 border-b border-border/50 p-2 sm:space-y-3 sm:p-4">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
              <Tabs value={taskView} onValueChange={(v) => setTaskView(v as 'list' | 'board')}>
                <TabsList className="h-11">
                  <TabsTrigger value="list" className="min-h-11 px-2.5 text-xs sm:px-3">
                    <List className="h-3.5 w-3.5 mr-1" />{t('tasks.list')}
                  </TabsTrigger>
                  <TabsTrigger value="board" className="min-h-11 px-2.5 text-xs sm:px-3">
                    <LayoutGrid className="h-3.5 w-3.5 mr-1" />{t('tasks.board')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {taskView === 'list' && (
                <Button
                  variant={selectionMode ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-label={selectionMode ? t('cancel') : t('tasks.selection.select')}
                  className="h-11 w-11 gap-1.5 px-0 text-xs sm:h-9 sm:w-auto sm:px-3"
                  onClick={() => {
                    setSelectionMode(prev => !prev)
                    setSelectedIds(new Set())
                  }}
                >
                  <MousePointer2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{selectionMode ? t('cancel') : t('tasks.selection.select')}</span>
                  <span className="sr-only sm:hidden">{selectionMode ? t('cancel') : t('tasks.selection.select')}</span>
                </Button>
              )}
              <details className="group/status relative">
                <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground [&::-webkit-details-marker]:hidden sm:px-3">
                  <span className="hidden sm:inline">{uiText('Status filters')}</span><span className="sm:hidden">{uiText('Filter')}</span><ChevronDown className="ml-1.5 h-3.5 w-3.5 transition-transform group-open/status:rotate-180 sm:ml-2" />
                </summary>
                <div className="absolute left-0 top-full z-20 mt-1 flex min-w-44 flex-col rounded-lg border bg-popover p-1 shadow-lg">
                  {(['all', 'todo', 'in-progress', 'done'] as const).map((filter) => {
                    const count = filter === 'all' ? tasks.length : tasks.filter(t => t.status === filter).length
                    const isActive = taskFilter === filter && queueFilter === 'all'
                    return (
                      <button key={filter} type="button" className={cn('flex min-h-11 items-center justify-between gap-4 rounded-md px-3 text-left text-sm hover:bg-accent', isActive && 'bg-accent font-medium')} onClick={() => { setQueueFilter('all'); setTaskFilter(filter) }}>
                        <span>{filter === 'all' ? t('tasks.all') : filter === 'in-progress' ? t('tasks.inProgress') : filter === 'todo' ? t('tasks.todo') : t('tasks.done')}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{count}</span>
                      </button>
                    )
                  })}
                </div>
              </details>
            </div>
            <div className="flex items-center gap-1.5 self-start sm:self-auto sm:gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" aria-label={t('tasks.templates')} className="h-11 w-11 gap-1.5 px-0 sm:h-9 sm:w-auto sm:px-3">
                    <LayoutTemplate className="h-4 w-4" /><span className="hidden sm:inline">{t('tasks.templates')}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="end">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">{t('tasks.addTask')}</p>
                    {taskTemplates.map((template) => (
                      <button
                        key={template.title}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-accent transition-colors text-sm group"
                        onClick={() => handleTemplateSelect(template)}
                      >
                        <Badge className={cn(`${priorityColors[template.priority]} text-[9px] shrink-0 px-1.5 py-0 rounded-full font-semibold`)}>
                          {uiText(template.priority)}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-xs truncate">{uiText(template.title)}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{uiText(template.description)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" aria-label={t('tasks.addTask')} className="h-11 w-11 p-0 sm:h-9 sm:w-auto sm:px-3">
                    <Plus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">{t('tasks.addTask')}</span>
                  </Button>
                </DialogTrigger>
              <DialogContent
                aria-describedby={undefined}
                className="w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] flex flex-col gap-0 overflow-hidden border-0 p-0 shadow-2xl sm:max-h-[min(90dvh,800px)] sm:max-w-[560px]"
              >
                {/* Gradient accent strip */}
                <div
                  className="h-1 w-full"
                  style={{ background: `linear-gradient(90deg, ${accentHex}, ${accentHex}66, transparent)` }}
                />
                <DialogHeader className="px-4 pt-5 pb-3 sm:px-6">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${accentHex}1a`, color: accentHex }}
                    >
                      <Sparkles className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0">
                      <DialogTitle className="text-base font-semibold leading-tight">
                        {t('tasks.newTask')}
                      </DialogTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('tasks.composer.subtitle')}
                      </p>
                    </div>
                  </div>
                  <DialogDescription className="sr-only">{uiText("Create a new task for your workflow")}</DialogDescription>
                </DialogHeader>

                <div
                  className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      handleAddTask()
                    }
                  }}
                >
                  {/* Title — big, borderless, primary input */}
                  <input
                    autoFocus
                    placeholder={t('tasks.composer.titlePlaceholder')}
                    value={newTask.title}
                    onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full text-lg md:text-xl font-medium bg-transparent border-0 outline-none placeholder:text-muted-foreground/50 focus:ring-0 px-0 py-1"
                  />

                  {/* Description — subtle bg, auto height */}
                  <Textarea
                    placeholder={t('tasks.composer.descPlaceholder')}
                    value={newTask.description}
                    onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                    className="min-h-[68px] resize-none bg-muted/40 border-border/60 focus-visible:bg-muted/60 text-sm"
                  />

                  {/* Priority pills */}
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-2">
                      {t('tasks.composer.priorityLabel')}
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(['low', 'medium', 'high', 'urgent'] as const).map((p) => {
                        const active = newTask.priority === p
                        const dot = { low: '#3b82f6', medium: '#f59e0b', high: '#f97316', urgent: '#ef4444' }[p]
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setNewTask(prev => ({ ...prev, priority: p }))}
                            className={cn(
                              'flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-all',
                              active
                                ? 'border-transparent text-foreground shadow-sm'
                                : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent/40'
                            )}
                            style={active ? { backgroundColor: `${dot}1a`, boxShadow: `0 0 0 1px ${dot}55 inset` } : undefined}
                          >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />
                            {t(`tasks.${p}`)}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Attribute chips: Due / Project / Recurrence / Tags */}
                  <div className="flex flex-wrap gap-2">
                    {/* Due date chip */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                            newTask.dueDate
                              ? 'border-transparent text-foreground'
                              : 'border-border/70 text-muted-foreground hover:bg-accent/40'
                          )}
                          style={newTask.dueDate ? { backgroundColor: `${accentHex}1a`, color: accentHex } : undefined}
                        >
                          <CalendarDays className="h-3.5 w-3.5" />
                          {newTask.dueDate
                            ? new Date(newTask.dueDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                            : t('tasks.composer.noDue')}
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-60 p-2">
                        <div className="space-y-0.5">
                          {[
                            { id: 'today', label: t('tasks.composer.today'), days: 0 },
                            { id: 'tomorrow', label: t('tasks.composer.tomorrow'), days: 1 },
                            { id: 'thisWeek', label: t('tasks.composer.thisWeek'), days: ((7 - new Date().getDay()) || 7) },
                          ].map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              className="w-full flex items-center justify-between text-xs px-2.5 py-1.5 rounded-md hover:bg-accent text-left"
                              onClick={() => {
                                const d = new Date()
                                d.setDate(d.getDate() + opt.days)
                                const iso = d.toISOString().slice(0, 10)
                                setNewTask(prev => ({ ...prev, dueDate: iso }))
                              }}
                            >
                              <span>{opt.label}</span>
                              <span className="text-muted-foreground">
                                {(() => { const d = new Date(); d.setDate(d.getDate() + opt.days); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })()}
                              </span>
                            </button>
                          ))}
                          <div className="border-t border-border/60 my-1" />
                          <label className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 block">
                            {t('tasks.composer.pickDate')}
                          </label>
                          <Input
                            type="date"
                            value={newTask.dueDate}
                            onChange={(e) => setNewTask(prev => ({ ...prev, dueDate: e.target.value }))}
                            className="h-8 text-xs"
                          />
                          {newTask.dueDate && (
                            <button
                              type="button"
                              className="w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-accent text-muted-foreground mt-1"
                              onClick={() => setNewTask(prev => ({ ...prev, dueDate: '' }))}
                            >
                              {t('tasks.composer.clearDate')}
                            </button>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Project chip */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                            newTask.projectId
                              ? 'border-transparent text-foreground'
                              : 'border-border/70 text-muted-foreground hover:bg-accent/40'
                          )}
                          style={newTask.projectId ? { backgroundColor: `${accentHex}1a`, color: accentHex } : undefined}
                        >
                          <Folder className="h-3.5 w-3.5" />
                          {newTask.projectId
                            ? (projects.find(p => p.id === newTask.projectId)?.name ?? t('tasks.composer.project'))
                            : t('tasks.composer.noProject')}
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56 p-1">
                        <button
                          type="button"
                          className="w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-accent text-muted-foreground"
                          onClick={() => setNewTask(prev => ({ ...prev, projectId: '' }))}
                        >
                          {t('tasks.composer.noProject')}
                        </button>
                        {projects.length > 0 && <div className="border-t border-border/60 my-1" />}
                        {projects.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            className={cn(
                              'w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-accent flex items-center justify-between',
                              newTask.projectId === p.id && 'bg-accent/60'
                            )}
                            onClick={() => setNewTask(prev => ({ ...prev, projectId: p.id }))}
                          >
                            <span className="truncate">{p.name}</span>
                            {newTask.projectId === p.id && <Check className="h-3.5 w-3.5" style={{ color: accentHex }} />}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>

                    {/* Recurrence chip */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                            newTask.recurrence && newTask.recurrence !== 'none'
                              ? 'border-transparent text-foreground'
                              : 'border-border/70 text-muted-foreground hover:bg-accent/40'
                          )}
                          style={newTask.recurrence && newTask.recurrence !== 'none' ? { backgroundColor: `${accentHex}1a`, color: accentHex } : undefined}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {(() => {
                            const r = newTask.recurrence
                            if (!r || r === 'none') return t('tasks.composer.recurrenceNone')
                            return t(`tasks.composer.recurrence${r.charAt(0).toUpperCase() + r.slice(1)}`) !== `tasks.composer.recurrence${r.charAt(0).toUpperCase() + r.slice(1)}`
                              ? t(`tasks.composer.recurrence${r.charAt(0).toUpperCase() + r.slice(1)}`)
                              : ({ daily: uiText('Günlük'), weekly: uiText('Haftalık'), monthly: uiText('Aylık') } as Record<string, string>)[r]
                          })()}
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-44 p-1">
                        {([
                          ['none', t('tasks.composer.recurrenceNone')],
                          ['daily', uiText('Günlük')],
                          ['weekly', uiText('Haftalık')],
                          ['monthly', uiText('Aylık')],
                        ] as const).map(([val, label]) => {
                          const active = (newTask.recurrence ?? 'none') === val
                          return (
                            <button
                              key={val}
                              type="button"
                              className={cn(
                                'w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-accent flex items-center justify-between',
                                active && 'bg-accent/60'
                              )}
                              onClick={() => setNewTask(prev => ({ ...prev, recurrence: val as Task['recurrence'] }))}
                            >
                              <span>{label}</span>
                              {active && <Check className="h-3.5 w-3.5" style={{ color: accentHex }} />}
                            </button>
                          )
                        })}
                      </PopoverContent>
                    </Popover>

                    {/* Tags chip */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                            newTask.tags.trim()
                              ? 'border-transparent text-foreground'
                              : 'border-border/70 text-muted-foreground hover:bg-accent/40'
                          )}
                          style={newTask.tags.trim() ? { backgroundColor: `${accentHex}1a`, color: accentHex } : undefined}
                        >
                          <Hash className="h-3.5 w-3.5" />
                          {newTask.tags.trim()
                            ? `${newTask.tags.split(',').map(s => s.trim()).filter(Boolean).length} ${t('tasks.tags').toLowerCase()}`
                            : t('tasks.tags')}
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 p-3 space-y-2">
                        <Input
                          placeholder={t('tasks.composer.tagsPlaceholder')}
                          value={newTask.tags}
                          onChange={(e) => setNewTask(prev => ({ ...prev, tags: e.target.value }))}
                          className="h-8 text-xs"
                        />
                        {newTask.tags.trim() && (
                          <div className="flex flex-wrap gap-1">
                            {newTask.tags.split(',').map(s => s.trim()).filter(Boolean).map((tag, i) => (
                              <Badge key={`${tag}-${i}`} variant="secondary" className="text-[10px] font-normal py-0.5">
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <DialogFooter className="sticky bottom-0 flex-row items-center justify-end gap-2 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:justify-between sm:px-6">
                  <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {t('tasks.composer.cmdEnter')}
                    <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border/70 bg-background text-[10px] font-medium">
                      <Command className="h-2.5 w-2.5" />Enter
                    </kbd>
                    {t('tasks.composer.cmdEnterAction')}
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    <DialogClose asChild>
                      <Button variant="ghost" size="sm">{t('cancel')}</Button>
                    </DialogClose>
                    <Button
                      size="sm"
                      onClick={handleAddTask}
                      disabled={createTaskMutation.isPending || !newTask.title.trim()}
                      className="gap-1.5 text-white hover:opacity-95"
                      style={{ backgroundColor: accentHex, boxShadow: `0 10px 24px -10px ${accentHex}` }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('tasks.createTask')}
                    </Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`${t('search')}...`}
              className="h-11 pl-9 sm:h-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>}

        {/* Task Content */}
        {taskSection === 'mine' ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : taskView === 'list' ? (
            <Listview
              tasks={filteredTasks}
              projects={projects}
              selectedTaskId={selectedTaskId}
              celebratingTaskId={celebratingTaskId}
              onSelectTask={openTaskWorkspace}
              onToggleStatus={toggleTaskStatus}
              onDeleteTask={deleteTask}
              onEditTask={openEditDialog}
              onMoveTask={moveTask}
              accentHex={accentHex}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelectId}
              onAdd={() => setCreateDialogOpen(true)}
            />
          ) : (
            <Boardview
              todoTasks={todoTasks}
              inProgressTasks={inProgressTasks}
              doneTasks={doneTasks}
              projects={projects}
              selectedTaskId={selectedTaskId}
              celebratingTaskId={celebratingTaskId}
              onSelectTask={openTaskWorkspace}
              onMoveTask={moveTask}
              onDeleteTask={deleteTask}
              onEditTask={openEditDialog}
            />
          )}
        </div> : <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-base font-semibold">{uiText('Recurring tasks')}</h2><p className="mt-1 text-sm text-muted-foreground">{recurringTasksQuery.data?.schedulerEnabled ? uiText('Automatic continuation enabled') : uiText('Automatic continuation paused')}</p></div>
            <Badge variant="outline">{recurringTasksQuery.data?.schedulerEnabled ? uiText('Automatic continuation enabled') : uiText('Automatic continuation paused')}</Badge>
          </div>
          {recurringTasksQuery.isLoading ? <div className="flex gap-3 overflow-hidden">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-36 w-64 shrink-0 rounded-xl" />)}</div> : recurringTasksQuery.isError ? <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive/30 p-4 text-sm"><span>{uiText('Unable to load recurring tasks')}</span><Button variant="outline" size="sm" onClick={() => void recurringTasksQuery.refetch()}>{uiText('Retry')}</Button></div> : recurringTasksQuery.data?.series.length ? <div className="flex snap-x gap-3 overflow-x-auto overscroll-x-contain pb-3" aria-label={uiText('Recurring tasks')}>
            {recurringTasksQuery.data.series.map((series) => {
              const currentTask = tasks.find((task) => task.id === series.currentTaskId)
              if (!currentTask) return null
              const statusLabel = statusLabels[currentTask.status] || uiText('Status unavailable')
              return <button key={series.id} type="button" data-task-id={currentTask.id} onClick={() => openTaskWorkspace(currentTask.id)} className="w-64 shrink-0 snap-start rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${series.title}, ${statusLabel}, ${series.recurrence}`}>
                <div className="flex items-start justify-between gap-3"><span className="line-clamp-2 font-semibold">{series.title}</span><Badge variant={currentTask.status === 'done' ? 'secondary' : 'outline'}>{statusLabel}</Badge></div>
                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Repeat className="h-3.5 w-3.5" /><span>{uiText(series.recurrence)}</span></div>
                <div className="mt-3 text-xs text-muted-foreground">{series.dueDate ? `${t('tasks.dueDate')}: ${series.dueDate}` : uiText('No due date')}</div>
              </button>
            })}
          </div> : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{uiText('No recurring tasks')}</p>}
        </div>}
      </div>

      <Dialog open={!!selectedTask} onOpenChange={handleTaskWorkspaceOpenChange}>
        {selectedTask && <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(92dvh,900px)] sm:w-[calc(100vw-2rem)] sm:max-w-5xl sm:rounded-xl sm:border" aria-describedby="task-workspace-description">
          <DialogHeader className="sr-only"><DialogTitle>{taskWorkspaceMode === 'edit' ? t('tasks.editTask') : selectedTask.title}</DialogTitle><DialogDescription id="task-workspace-description">{t('tasks.taskDetails')}</DialogDescription></DialogHeader>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" aria-label={t('tasks.taskDetails')}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-8 sm:py-8">
              {taskWorkspaceMode === 'edit' ? taskEditContent : taskDetailContent}
            </div>
          </div>
          {taskWorkspaceMode === 'edit' && editTask && (
            <div className="flex-none border-t border-border bg-background/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-8">
              <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 sm:justify-end">
                <Button className="h-11 min-w-24" variant="outline" onClick={cancelTaskEdit}>{uiText('Back to task')}</Button>
                <Button className="h-11 min-w-24" onClick={handleUpdateTask} disabled={!editTask.title.trim() || updateTaskMutation.isPending}>{updateTaskMutation.isPending ? t('loading') : t('save')}</Button>
              </div>
            </div>
          )}
          </section>
        </DialogContent>}
      </Dialog>

      {/* Bulk Action Bar */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="lifeos-float-above-bottom fixed left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-card border border-border rounded-full shadow-lg px-2 sm:gap-2 sm:px-4 py-1.5 sm:py-2 z-50 max-w-[calc(100vw-1rem)] overflow-x-auto">
          <span className="text-sm font-medium">{selectedIds.size} {uiText("seçildi")}</span>
          <Separator orientation="vertical" className="h-4" />
          <Button size="sm" variant="ghost" className="h-11 shrink-0 px-2 sm:px-3" onClick={handleBulkDone}>
            <Check className="h-4 w-4 mr-1" /> {uiText("Tamamla")}
          </Button>
          <Button size="sm" variant="ghost" className="h-11 shrink-0 px-2 text-destructive sm:px-3" onClick={handleBulkDelete}>
            <Trash2 className="h-4 w-4 mr-1" /> {uiText("Sil")}
          </Button>
        </div>
      )}
    </div>
  )
}

function Listview({ tasks, projects, selectedTaskId, celebratingTaskId, onSelectTask, onToggleStatus, onDeleteTask, onEditTask, onMoveTask, accentHex = '#10b981', selectionMode = false, selectedIds = new Set<string>(), onToggleSelect, onAdd }: {
  tasks: Task[]
  projects: Project[]
  selectedTaskId: string | null
  celebratingTaskId: string | null
  onSelectTask: (id: string) => void
  onToggleStatus: (id: string) => void
  onDeleteTask: (id: string) => void
  onEditTask?: (task: Task) => void
  onMoveTask?: (id: string, status: Task['status']) => void
  accentHex?: string
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onAdd?: () => void
}) {
  useInterfaceLanguage()
  const { t } = useTranslation()
  const allSelected = tasks.length > 0 && tasks.every(t => selectedIds.has(t.id))

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-muted-foreground">
        <div className="text-center animate-bounce-in">
          <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-950/40 dark:to-amber-950/40 flex items-center justify-center shadow-sm">
            <CheckSquare className="h-10 w-10 text-orange-500" />
          </div>
          <p className="text-base font-semibold text-foreground">{t('tasks.noTasks')}</p>
          <p className="text-sm mt-1.5 text-muted-foreground/70 max-w-[240px] mx-auto">{t('tasks.noTasksDesc')}</p>
          <button
            type="button"
            onClick={onAdd}
            disabled={!onAdd}
            className="mt-4 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-full transition-all hover:scale-[1.03] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ color: accentHex, backgroundColor: `${accentHex}18`, boxShadow: `0 6px 18px -10px ${accentHex}` }}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('tasks.addTask')}</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 p-2 sm:space-y-2 sm:p-4">
      {selectionMode && (
        <div className="flex min-h-11 items-center gap-3 px-2 py-1.5 bg-muted/30 border-b border-border/50 sm:px-4">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => {
              if (allSelected) {
                tasks.forEach(t => { if (selectedIds.has(t.id)) onToggleSelect?.(t.id) })
              } else {
                tasks.forEach(t => { if (!selectedIds.has(t.id)) onToggleSelect?.(t.id) })
              }
            }}
          />
          <span className="text-xs text-muted-foreground">{allSelected ? t('tasks.selection.deselectAll') : t('tasks.selection.selectAll')}</span>
        </div>
      )}
      {tasks.map((task) => {
        const dueStatus = getDueDateStatus(task.dueDate)
        const isCelebrating = celebratingTaskId === task.id
        const isSelected = selectedIds.has(task.id)
        const rowContent = (
          <motion.article
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            data-task-id={task.id}
            tabIndex={0}
            aria-label={`${uiText('Open task details')}: ${task.title}`}
            aria-expanded={selectedTaskId === task.id}
            className={cn(
              'task-summary-card group grid min-w-0 cursor-pointer gap-2 border-l-[3px] px-2.5 py-2 transition-colors duration-200 hover:bg-accent/20 sm:gap-3 sm:rounded-xl sm:border sm:border-border/60 sm:px-4 sm:py-4',
              priorityBorderColors[task.priority],
              task.status === 'done' && '[&_.task-title]:text-muted-foreground [&_.task-title]:line-through',
              isCelebrating && 'animate-celebrate',
              isSelected && 'bg-accent/50'
            )}
            style={selectedTaskId === task.id && !selectionMode ? { borderLeftColor: accentHex, backgroundColor: 'var(--accent)' } : undefined}
            onClick={() => selectionMode ? onToggleSelect?.(task.id) : onSelectTask(task.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (selectionMode) onToggleSelect?.(task.id)
                else onSelectTask(task.id)
              }
            }}
            onDoubleClick={(e) => { if (selectionMode) return; e.stopPropagation(); onEditTask?.(task) }}
          >
            <div className="flex min-w-0 items-start gap-2 sm:gap-3">
              {selectionMode ? (
                <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect?.(task.id)} onClick={(e) => e.stopPropagation()} className="mt-1" />
              ) : (
                <Checkbox checked={task.status === 'done'} onCheckedChange={() => onToggleStatus(task.id)} onClick={(e) => e.stopPropagation()} className={cn('mt-1 transition-all duration-200', task.status === 'done' && 'animate-check-pop')} />
              )}
              <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <Badge className={cn(`${priorityColors[task.priority]} rounded-full border-0 px-2 py-0.5 text-[10px] font-semibold`, task.priority === 'urgent' && 'animate-pulse-urgent')}>{t(`tasks.${task.priority}`)}</Badge>
                  <Badge variant="outline" className="rounded-full text-[10px]">{task.status === 'in-progress' ? t('tasks.inProgress') : task.status === 'todo' ? t('tasks.todo') : t('tasks.done')}</Badge>
                  {task.projectId && <Badge variant="secondary" className="max-w-full truncate rounded-full text-[10px]">{projects.find(project => project.id === task.projectId)?.name || uiText('Project unavailable')}</Badge>}
                  {task.dueDate && <Badge variant="outline" className={cn('rounded-full text-[10px]', dueStatus.className)}><Clock className="mr-1 h-2.5 w-2.5" />{uiText(dueStatus.label) || task.dueDate}</Badge>}
                  {task.recurrence && task.recurrence !== 'none' && <Badge variant="outline" className="rounded-full text-[10px] capitalize"><RefreshCw className="mr-1 h-2.5 w-2.5" />{task.recurrence}</Badge>}
                </div>
                <div className="min-w-0">
                  <p className={cn('task-title break-words text-[15px] font-semibold leading-snug', task.status === 'done' && 'line-through-animate text-muted-foreground')}>{task.title}</p>
                </div>
                {(splitTaskDescription(task.description).handoff || splitTaskDescription(task.description).body) && <div className="rounded-md bg-muted/30 px-2 py-1 sm:px-3 sm:py-2"><p className="hidden text-[10px] font-medium text-muted-foreground sm:block">{splitTaskDescription(task.description).handoff ? uiText('Latest progress') : uiText('Task materials')}</p><p className="line-clamp-1 break-words text-[11px] leading-snug text-foreground/75 sm:mt-1 sm:line-clamp-2 sm:text-xs sm:leading-relaxed">{splitTaskDescription(task.description).handoff || splitTaskDescription(task.description).body}</p></div>}
                {task.tags.length > 0 && <div className="flex flex-nowrap gap-1 overflow-hidden sm:flex-wrap">{task.tags.slice(0, 5).map(tag => <Badge key={tag} variant="outline" className="max-w-[40vw] shrink-0 truncate px-1.5 py-0 text-[10px]">#{tag}</Badge>)}{task.tags.length > 5 && <span className="shrink-0 text-[10px] text-muted-foreground">+{task.tags.length - 5}</span>}</div>}
                {!selectionMode && <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-border/50 pt-1.5 sm:gap-2 sm:pt-2">
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">{uiText('Open task details')}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {onMoveTask && task.status !== 'done' && <Button variant="outline" size="sm" className="h-11" onClick={(e) => { e.stopPropagation(); onMoveTask(task.id, task.status === 'todo' ? 'in-progress' : 'done') }}>{task.status === 'todo' ? uiText('Start') : t('tasks.markComplete')}</Button>}
                    <Button variant="ghost" size="icon" className="h-11 w-11" onClick={(e) => { e.stopPropagation(); onEditTask?.(task) }} title={t('edit')} aria-label={`${t('edit')}: ${task.title}`}><Edit3 className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id) }} title={t('delete')} aria-label={`${t('delete')}: ${task.title}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>}
              </div>
            </div>
          </motion.article>
        )

        // Always wrap in context menu for consistency
        return (
          <ContextMenu key={task.id}>
            <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
            <ContextMenuContent className="w-48">
              {selectionMode ? (
                <>
                  <ContextMenuItem onClick={() => onToggleSelect?.(task.id)}>
                    <Check className="h-3.5 w-3.5 mr-2" />
                    {isSelected ? t('tasks.selection.deselect') : t('tasks.selection.select')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem 
                    disabled={selectedIds.size === 0}
                    onClick={() => {
                      // Trigger bulk complete for all selected
                      selectedIds.forEach(id => onToggleStatus(id))
                    }}
                  >
                    <Check className="h-3.5 w-3.5 mr-2" />
                    {uiText("Seçilileri tamamla")}
                  </ContextMenuItem>
                  <ContextMenuItem 
                    disabled={selectedIds.size === 0}
                    onClick={() => {
                      // Trigger bulk delete for all selected
                      selectedIds.forEach(id => onDeleteTask(id))
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    {uiText("Seçilileri sil")}
                  </ContextMenuItem>
                </>
              ) : (
                <>
                  <ContextMenuItem onClick={() => onEditTask?.(task)}>
                    <Edit3 className="h-3.5 w-3.5 mr-2" />
                    {t('edit')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onToggleStatus(task.id)}>
                    <Check className="h-3.5 w-3.5 mr-2" />
                    {task.status === 'done' ? t('tasks.markAsTodo') : t('tasks.markAsDone')}
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <ChevronRight className="h-3.5 w-3.5 mr-2" />
                      {t('tasks.moveTo')}
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-36">
                      <ContextMenuItem
                        disabled={task.status === 'todo'}
                        onClick={() => onMoveTask?.(task.id, 'todo')}
                      >
                        {t('tasks.todo')}
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={task.status === 'in-progress'}
                        onClick={() => onMoveTask?.(task.id, 'in-progress')}
                      >
                        {t('tasks.inProgress')}
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={task.status === 'done'}
                        onClick={() => onMoveTask?.(task.id, 'done')}
                      >
                        {t('tasks.done')}
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => onDeleteTask(task.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    {t('delete')}
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}

function Boardview({ todoTasks, inProgressTasks, doneTasks, projects, selectedTaskId, celebratingTaskId, onSelectTask, onMoveTask, onDeleteTask, onEditTask }: {
  todoTasks: Task[]
  inProgressTasks: Task[]
  doneTasks: Task[]
  projects: Project[]
  selectedTaskId: string | null
  celebratingTaskId: string | null
  onSelectTask: (id: string) => void
  onMoveTask: (id: string, status: Task['status']) => void
  onDeleteTask: (id: string) => void
  onEditTask?: (task: Task) => void
}) {
  useInterfaceLanguage()
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<Task['status'] | null>(null)
  const [localTasks, setLocalTasks] = useState<Record<string, { status: Task['status'] }>>({})

  const columns = [
    { title: t('tasks.toDoColumn'), tasks: todoTasks, status: 'todo' as const, color: 'bg-slate-400', headerBg: '', colBg: 'bg-muted/20', emptyIcon: '📋', emptyText: t('tasks.noTasks'), borderColor: 'border-slate-200 dark:border-slate-800', topBorder: 'bg-slate-300 dark:bg-slate-700' },
    { title: t('tasks.inProgressColumn'), tasks: inProgressTasks, status: 'in-progress' as const, color: 'bg-amber-500', headerBg: '', colBg: 'bg-amber-50/30 dark:bg-amber-950/10', emptyIcon: '🔨', emptyText: t('tasks.nothingInProgress'), borderColor: 'border-amber-200 dark:border-amber-900', topBorder: 'bg-amber-400' },
    { title: t('tasks.doneColumn'), tasks: doneTasks, status: 'done' as const, color: 'bg-emerald-500', headerBg: '', colBg: 'bg-emerald-50/20 dark:bg-emerald-950/10', emptyIcon: '🎉', emptyText: t('tasks.completeSomeTasks'), borderColor: 'border-emerald-200 dark:border-emerald-900', topBorder: 'bg-emerald-400' },
  ]

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Build all task IDs for SortableContext
  const allTaskIds = useMemo(() => [
    ...todoTasks.map(t => t.id),
    ...inProgressTasks.map(t => t.id),
    ...doneTasks.map(t => t.id),
  ], [todoTasks, inProgressTasks, doneTasks])

  const activeTask = useMemo(() => {
    if (!activeId) return null
    const allTasks = [...todoTasks, ...inProgressTasks, ...doneTasks]
    return allTasks.find(t => t.id === activeId)
  }, [activeId, todoTasks, inProgressTasks, doneTasks])

  const findColumnForTask = useCallback((taskId: string): Task['status'] | null => {
    if (todoTasks.find(t => t.id === taskId)) return 'todo'
    if (inProgressTasks.find(t => t.id === taskId)) return 'in-progress'
    if (doneTasks.find(t => t.id === taskId)) return 'done'
    return null
  }, [todoTasks, inProgressTasks, doneTasks])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event
    if (!over) {
      setOverColumn(null)
      return
    }

    // Check if we're over a column (by checking the over data)
    const overData = over.data.current
    if (overData?.status) {
      setOverColumn(overData.status as Task['status'])
      return
    }

    // We're over a task card - find which column that card belongs to
    const overTaskId = over.id as string
    const overTaskStatus = findColumnForTask(overTaskId)
    if (overTaskStatus) {
      setOverColumn(overTaskStatus)
    }
  }, [findColumnForTask])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setOverColumn(null)

    if (!over || !active) return

    const taskId = active.id as string
    const currentStatus = findColumnForTask(taskId)
    if (!currentStatus) return

    // Determine the target column
    let targetStatus: Task['status'] | null = null

    // Check if dropped on a column container
    const overData = over.data.current
    if (overData?.status) {
      targetStatus = overData.status as Task['status']
    } else {
      // Dropped on another task - find that task's column
      const overTaskStatus = findColumnForTask(over.id as string)
      if (overTaskStatus) {
        targetStatus = overTaskStatus
      }
    }

    if (targetStatus && targetStatus !== currentStatus) {
      onMoveTask(taskId, targetStatus)
      showToast.success(uiText("Task moved"), `Task moved to ${targetStatus}`)
    }
  }, [findColumnForTask, onMoveTask])

  const handleDragCancel = useCallback(() => {
    setActiveId(null)
    setOverColumn(null)
  }, [])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="p-4 h-full">
        <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {columns.map((col) => {
            const isOver = overColumn === col.status && activeId !== null
            const taskIds = col.tasks.map(t => t.id)
            return (
              <SortableContext key={col.status} items={taskIds} strategy={verticalListSortingStrategy}>
                <DroppableColumn
                  status={col.status}
                  isOver={isOver}
                  className={cn(
                    'flex flex-col rounded-xl bg-muted/30 border-2 transition-all duration-200',
                    isOver ? 'border-primary/50 bg-primary/5' : 'border-border/30',
                    col.colBg
                  )}
                >
                  {/* Colored top border */}
                  <div className={cn('h-1.5 rounded-t-xl', col.topBorder)} />
                  {/* Column Header */}
                  <div className={cn('px-3 py-2.5 border-b border-border/30', col.headerBg)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-2.5 h-2.5 rounded-full', col.color)} />
                        <h3 className="text-sm font-semibold">{col.title}</h3>
                      </div>
                      <span className={cn(
                        'inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[10px] font-bold',
                        col.color, 'text-white'
                      )}>
                        {col.tasks.length}
                      </span>
                    </div>
                  </div>
                  {/* Column Content */}
                  <ScrollArea className="flex-1 p-2">
                    <div className="space-y-2 min-h-[60px]">
                      {col.tasks.map((task) => (
                        <SortableTaskCard
                          key={task.id}
                          task={task}
                          projectName={projects.find(project => project.id === task.projectId)?.name}
                          selectedTaskId={selectedTaskId}
                          celebratingTaskId={celebratingTaskId}
                          onSelectTask={onSelectTask}
                          onMoveTask={onMoveTask}
                          onDeleteTask={onDeleteTask}
                          onEditTask={onEditTask}
                          columnStatus={col.status}
                        />
                      ))}
                      {col.tasks.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                          <div className="text-3xl mb-2">{col.emptyIcon}</div>
                          <p className="font-medium">{col.emptyText}</p>
                          {isOver && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="mt-2 p-3 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 text-primary text-xs font-medium"
                            >
                              {uiText("Drop here")}
                            </motion.div>
                          )}
                        </div>
                      )}
                      {/* Drop indicator at the bottom of non-empty columns */}
                      {col.tasks.length > 0 && isOver && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="p-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 text-primary text-xs font-medium text-center"
                        >
                          {uiText("Drop here")}
                        </motion.div>
                      )}
                    </div>
                  </ScrollArea>
                </DroppableColumn>
              </SortableContext>
            )
          })}
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeTask ? (
          <Card className="shadow-2xl border-l-[3px] rotate-2 scale-105 w-64 opacity-95" style={{ borderColor: undefined }}>
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">{activeTask.title}</p>
                </div>
                <Badge className={cn(`${priorityColors[activeTask.priority]} text-[10px] shrink-0 ml-2`)}>
                  {activeTask.priority}
                </Badge>
              </div>
              {activeTask.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 pl-6">{activeTask.description}</p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
