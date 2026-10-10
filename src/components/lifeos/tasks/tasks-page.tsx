'use client'

import { uiText, useInterfaceLanguage } from '@/lib/i18n/interface-copy'

import { useState, useMemo, useCallback, useEffect } from 'react'
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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
import { useTasks, useProjects, useCreateTask, useUpdateTask, useDeleteTask } from '@/lib/api/hooks'
import { useIsMobile } from '@/hooks/use-mobile'
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
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/50 pt-2.5 sm:grid-cols-3">
        <div className="min-w-0">
          <span className="block text-[10px] text-muted-foreground">{uiText('Worker')}</span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">{uiText('Executor not configured')}</span>
        </div>
        <div className="min-w-0">
          <span className="block text-[10px] text-muted-foreground">{uiText('Pending confirmations')}</span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">{uiText('Acceptance flow not configured')}</span>
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <span className="block text-[10px] text-muted-foreground">{uiText('Execution')}</span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">{uiText('No execution record')}</span>
        </div>
      </div>
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

// Map API task to local Task type
function mapApiTask(apiTask: Record<string, unknown>): Task {
  const dueDate = apiTask.dueDate ? new Date(apiTask.dueDate as string).toISOString().split('T')[0] : null
  const startDate = apiTask.startDate ? new Date(apiTask.startDate as string).toISOString().split('T')[0] : null
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
    estimatedMinutes: (apiTask.estimatedMinutes as number) || null,
    actualMinutes: (apiTask.actualMinutes as number) || null,
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
          <div className="pl-7"><TaskRunSignals task={task} /></div>
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
  const accentColor = useAppStore((s) => s.accentColor)
  const { t } = useTranslation()
  const statusLabels: Record<string, string> = useMemo(() => ({
    'todo': t('tasks.todo'),
    'in-progress': t('tasks.inProgress'),
    'done': t('tasks.done'),
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

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium' as Task['priority'], dueDate: '', projectId: '', tags: '', recurrence: 'none' as Task['recurrence'] })
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Edit-task dialog state — populated when the user clicks "Edit" in the
  // context menu or double-clicks a task title.
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editTask, setEditTask] = useState<{ id: string; title: string; description: string; priority: Task['priority']; dueDate: string; projectId: string; status: Task['status']; recurrence: Task['recurrence'] } | null>(null)
  const [handoffDraft, setHandoffDraft] = useState('')
  const isMobile = useIsMobile()

  const selectedTask = useMemo(() => tasks.find(t => t.id === selectedTaskId), [tasks, selectedTaskId])

  useEffect(() => {
    setHandoffDraft(selectedTask ? splitTaskDescription(selectedTask.description).handoff : '')
  }, [selectedTask?.id, selectedTask?.description])

  const filteredTasks = useMemo(() => {
    let result = tasks
    if (taskFilter !== 'all') {
      result = result.filter(t => t.status === taskFilter)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    }
    return result
  }, [tasks, taskFilter, searchQuery])

  const todoTasks = filteredTasks.filter(t => t.status === 'todo')
  const inProgressTasks = filteredTasks.filter(t => t.status === 'in-progress')
  const doneTasks = filteredTasks.filter(t => t.status === 'done')

  // Productivity Score & Completion Progress
  const taskCompletionPct = tasks.length > 0 ? Math.round((tasks.filter(t => t.status === 'done').length / tasks.length) * 100) : 0
  const overdueTasks = tasks.filter(t => {
    if (!t.dueDate || t.status === 'done') return false
    const due = new Date(t.dueDate)
    due.setHours(0, 0, 0, 0)
    return due < new Date(new Date().toISOString().split('T')[0])
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

  // Open the edit dialog pre-filled with a task's current values
  const openEditDialog = useCallback((task: Task) => {
    setEditTask({
      id: task.id,
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      dueDate: task.dueDate || '',
      projectId: task.projectId || '',
      status: task.status,
      recurrence: task.recurrence || 'none',
    })
    setEditDialogOpen(true)
  }, [])

  const handleUpdateTask = useCallback(() => {
    if (!editTask || !editTask.title.trim()) return
    updateTaskMutation.mutate({
      id: editTask.id,
      title: editTask.title,
      description: editTask.description,
      priority: editTask.priority,
      dueDate: editTask.dueDate || null,
      projectId: editTask.projectId || null,
      status: editTask.status,
      recurrence: editTask.recurrence !== 'none' ? editTask.recurrence : null,
    }, {
      onSuccess: () => {
        setEditDialogOpen(false)
        setEditTask(null)
        showToast.success(t('toast.saved'))
      },
    })
  }, [editTask, updateTaskMutation, t])

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

  const taskDetailContent = selectedTask ? (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <h3 className="font-semibold">{selectedTask.title}</h3>
        <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-7 sm:w-7 shrink-0" aria-label={t('close')} onClick={() => setSelectedTaskId(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={`${priorityColors[selectedTask.priority]} text-xs rounded-full border-0`}>{selectedTask.priority}</Badge>
        <Badge className={cn('text-xs rounded-full border-0', selectedTask.status === 'done' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : selectedTask.status === 'in-progress' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-slate-500/10 text-slate-600 dark:text-slate-400')}>{selectedTask.status === 'in-progress' ? t('tasks.inProgress') : selectedTask.status === 'todo' ? t('tasks.todo') : t('tasks.done')}</Badge>
        {selectedTask.dueDate && (
          <Badge variant="outline" className={cn('text-xs', getDueDateStatus(selectedTask.dueDate).className)}>
            <Calendar className="h-3 w-3 mr-1" />{selectedTask.dueDate}
          </Badge>
        )}
      </div>
      <Separator />
      <section className="space-y-2 rounded-xl border border-border/60 bg-card p-3.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{uiText('Task materials')}</p>
        {splitTaskDescription(selectedTask.description).body
          ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{splitTaskDescription(selectedTask.description).body}</p>
          : <p className="text-sm text-muted-foreground">{uiText('No data')}</p>}
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {selectedTask.projectId && projectNames.get(selectedTask.projectId) && <Badge variant="secondary" className="max-w-full truncate">{projectNames.get(selectedTask.projectId)}</Badge>}
          {selectedTask.tags.map(tag => <Badge key={tag} variant="outline" className="max-w-full truncate">#{tag}</Badge>)}
          {selectedTask.recurrence && selectedTask.recurrence !== 'none' && <Badge variant="outline" className="capitalize">{selectedTask.recurrence}</Badge>}
        </div>
      </section>
      <section className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{uiText('Execution log')}</p>
        <TaskRunSignals task={selectedTask} />
        <p className="text-xs leading-5 text-muted-foreground">{uiText('No execution is connected to this task.')}</p>
      </section>
      <section className="space-y-2 rounded-xl border border-border/60 bg-card p-3.5">
        <p …8535 tokens truncated…            <Select
                          value={editTask.status}
                          onValueChange={(v) => setEditTask((p) => p && ({ ...p, status: v as Task['status'] }))}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todo">{t('tasks.todo')}</SelectItem>
                            <SelectItem value="in-progress">{t('tasks.inProgress')}</SelectItem>
                            <SelectItem value="done">{t('tasks.done')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">{t('tasks.dueDate')}</label>
                        <Input
                          type="date"
                          value={editTask.dueDate}
                          onChange={(e) => setEditTask((p) => p && ({ ...p, dueDate: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">{t('tasks.project')}</label>
                        <Select
                          value={editTask.projectId || 'none'}
                          onValueChange={(v) => setEditTask((p) => p && ({ ...p, projectId: v === 'none' ? '' : v }))}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            {projects.map((pr) => (
                              <SelectItem key={pr.id} value={pr.id}>{pr.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">{t('tasks.composer.recurrence')}</label>
                      <Select
                        value={editTask.recurrence || 'none'}
                        onValueChange={(v) => setEditTask((p) => p && ({ ...p, recurrence: v as Task['recurrence'] }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('tasks.composer.recurrenceNone')}</SelectItem>
                          <SelectItem value="daily">{t('habits.daily')}</SelectItem>
                          <SelectItem value="weekly">{t('habits.weekly')}</SelectItem>
                          <SelectItem value="monthly">{t('habits.monthly')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{t('cancel')}</Button>
                  </DialogClose>
                  <Button
                    onClick={handleUpdateTask}
                    disabled={!editTask || !editTask.title.trim() || updateTaskMutation.isPending}
                  >
                    {t('save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`${t('search')}...`}
              className="pl-9 h-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Task Content */}
        <div className="flex-1 overflow-auto">
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
              onSelectTask={setSelectedTaskId}
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
              onSelectTask={setSelectedTaskId}
              onMoveTask={moveTask}
              onDeleteTask={deleteTask}
              onEditTask={openEditDialog}
            />
          )}
        </div>
      </div>

      {/* Detail Panel - Desktop */}
      {selectedTask && !isMobile && (
        <div className="w-80 border-l border-border/50 bg-background shrink-0">
          <div className="p-5">{taskDetailContent}</div>
        </div>
      )}

      {/* Detail Panel - Mobile Sheet */}
      {selectedTask && isMobile && (
        <Sheet open={!!selectedTaskId} onOpenChange={(open) => { if (!open) setSelectedTaskId(null) }}>
          <SheetContent side="right" className="lifeos-safe-bottom-lg w-[min(24rem,92vw)] p-4 sm:p-5">
            <SheetHeader className="sr-only">
              <SheetTitle>{t('tasks.taskDetails')}</SheetTitle>
            </SheetHeader>
            {taskDetailContent}
          </SheetContent>
        </Sheet>
      )}

      {/* Bulk Action Bar */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="lifeos-float-above-bottom fixed left-1/2 -translate-x-1/2 flex items-center gap-2 bg-card border border-border rounded-full shadow-lg px-3 sm:px-4 py-2 z-50 max-w-[calc(100vw-1rem)] overflow-x-auto">
          <span className="text-sm font-medium">{selectedIds.size} {uiText("seçildi")}</span>
          <Separator orientation="vertical" className="h-4" />
          <Button size="sm" variant="ghost" onClick={handleBulkDone}>
            <Check className="h-4 w-4 mr-1" /> {uiText("Tamamla")}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={handleBulkDelete}>
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
    <div className="space-y-2 p-3 sm:p-4">
      {selectionMode && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 border-b border-border/50">
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
            className={cn(
              'task-summary-card group grid min-w-0 cursor-pointer gap-3 border-l-[3px] px-3.5 py-3.5 transition-all duration-200 hover:bg-accent/20 sm:rounded-xl sm:border sm:border-border/60 sm:px-4 sm:py-4',
              priorityBorderColors[task.priority],
              task.status === 'done' && 'opacity-60',
              isCelebrating && 'animate-celebrate',
              isSelected && 'bg-accent/50'
            )}
            style={selectedTaskId === task.id && !selectionMode ? { borderLeftColor: accentHex, backgroundColor: 'var(--accent)' } : undefined}
            onClick={() => selectionMode ? onToggleSelect?.(task.id) : onSelectTask(task.id)}
            onDoubleClick={(e) => { if (selectionMode) return; e.stopPropagation(); onEditTask?.(task) }}
          >
            <div className="flex min-w-0 items-start gap-3">
              {selectionMode ? (
                <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect?.(task.id)} onClick={(e) => e.stopPropagation()} className="mt-1" />
              ) : (
                <Checkbox checked={task.status === 'done'} onCheckedChange={() => onToggleStatus(task.id)} onClick={(e) => e.stopPropagation()} className={cn('mt-1 transition-all duration-200', task.status === 'done' && 'animate-check-pop')} />
              )}
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <Badge className={cn(`${priorityColors[task.priority]} rounded-full border-0 px-2 py-0.5 text-[10px] font-semibold`, task.priority === 'urgent' && 'animate-pulse-urgent')}>{t(`tasks.${task.priority}`)}</Badge>
                  <Badge variant="outline" className="rounded-full text-[10px]">{task.status === 'in-progress' ? t('tasks.inProgress') : task.status === 'todo' ? t('tasks.todo') : t('tasks.done')}</Badge>
                  {task.projectId && <Badge variant="secondary" className="max-w-full truncate rounded-full text-[10px]">{projects.find(project => project.id === task.projectId)?.name || uiText('Project unavailable')}</Badge>}
                  {task.dueDate && <Badge variant="outline" className={cn('rounded-full text-[10px]', dueStatus.className)}><Clock className="mr-1 h-2.5 w-2.5" />{uiText(dueStatus.label) || task.dueDate}</Badge>}
                  {task.recurrence && task.recurrence !== 'none' && <Badge variant="outline" className="rounded-full text-[10px] capitalize"><RefreshCw className="mr-1 h-2.5 w-2.5" />{task.recurrence}</Badge>}
                </div>
                <div className="min-w-0">
                  <p className={cn('break-words text-[15px] font-semibold leading-snug', task.status === 'done' && 'line-through-animate text-muted-foreground')}>{task.title}</p>
                  {splitTaskDescription(task.description).body && <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">{splitTaskDescription(task.description).body}</p>}
                </div>
                <TaskRunSignals task={task} />
                {task.tags.length > 0 && <div className="flex flex-wrap gap-1">{task.tags.slice(0, 5).map(tag => <Badge key={tag} variant="outline" className="max-w-full truncate px-1.5 py-0 text-[10px]">#{tag}</Badge>)}{task.tags.length > 5 && <span className="text-[10px] text-muted-foreground">+{task.tags.length - 5}</span>}</div>}
                {!selectionMode && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
                  <span className="text-[11px] text-muted-foreground">{uiText('Open task details')}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {onMoveTask && task.status !== 'done' && <Button variant="outline" size="sm" className="h-8" onClick={(e) => { e.stopPropagation(); onMoveTask(task.id, task.status === 'todo' ? 'in-progress' : 'done') }}>{task.status === 'todo' ? uiText('Start') : t('tasks.markComplete')}</Button>}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); onEditTask?.(task) }} title={t('edit')} aria-label={`${t('edit')}: ${task.title}`}><Edit3 className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id) }} title={t('delete')} aria-label={`${t('delete')}: ${task.title}`}><Trash2 className="h-3.5 w-3.5" /></Button>
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
