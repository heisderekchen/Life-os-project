'use client'

import { useEffect, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Controls, Handle, Position, useReactFlow, type Node, type NodeProps, type Edge } from '@xyflow/react'
import { ChevronRight, FileText, Folder, Layers } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { nodeKey, taskAncestors, taskTree, type TaskBranch, type WorkspaceGroup, type WorkspaceSelection } from './workspace-model'
import { WorkspaceContextMenu, WorkspaceActionsButton, type WorkspaceMenu } from './workspace-actions'
import '@xyflow/react/dist/style.css'

type Target = NonNullable<WorkspaceSelection>
type GraphData = { label: string; caption: string; kind: Target['kind']; expanded?: boolean; onExpand?: () => void; target: Target; onSelect: () => void; menu?: WorkspaceMenu; contextOnly?: boolean; zh: boolean }
type GraphNode = Node<GraphData, 'workspace'>
function WorkspaceNode({ data, selected }: NodeProps<GraphNode>) {
  const Icon = data.kind === 'project' ? Folder : data.kind === 'topic' ? Layers : FileText
  return <WorkspaceContextMenu menu={data.menu}><div className={`workspace-node ${selected ? 'is-selected' : ''} ${data.contextOnly ? 'is-context' : ''}`}>
    <Handle type="target" position={Position.Left} className="workspace-handle" />
    <button type="button" className="workspace-node-content nodrag nopan" onClick={event => { event.stopPropagation(); data.onSelect() }} aria-label={`${data.label}, ${data.caption}`} aria-pressed={selected}>
      <Icon size={18} aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={data.label}>{data.label}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{data.caption}</span></span>
    </button>
    {selected && data.menu && <WorkspaceActionsButton menu={data.menu} zh={data.zh} />}
    {data.onExpand && <button type="button" className="workspace-expand nodrag nopan" aria-label={`${data.expanded ? '收起 / Collapse' : '展开 / Expand'} ${data.label}`} aria-expanded={data.expanded} onClick={event => { event.stopPropagation(); data.onExpand?.() }}><ChevronRight size={15} className={data.expanded ? 'rotate-90' : ''} /></button>}
    <Handle type="source" position={Position.Right} className="workspace-handle" />
  </div></WorkspaceContextMenu>
}
const nodeTypes = { workspace: WorkspaceNode }

function Graph({ groups, selection, expanded, onExpand, onSelect, menuFor, matchedIds, zh }: {
  groups: WorkspaceGroup[]; selection: WorkspaceSelection; expanded: Set<string>; onExpand: (id: string) => void; onSelect: (selection: WorkspaceSelection) => void; menuFor: (target: Target) => WorkspaceMenu | undefined; matchedIds: Set<string>; zh: boolean
}) {
  const flow = useReactFlow<GraphNode>()
  const reducedMotion = useReducedMotion()
  const { nodes, edges } = useMemo(() => {
    const nodes: GraphNode[] = [], edges: Edge[] = []
    let y = 0
    const allTasks = groups.flatMap(group => group.tasks)
    const selectedTask = selection?.kind === 'task' ? allTasks.find(task => task.id === selection.id) : null
    const retained = new Set(selectedTask ? [selectedTask.id, ...taskAncestors(selectedTask, allTasks).map(task => task.id)] : [])
    const add = (id: string, target: Target, label: string, caption: string, x: number, at: number, expand?: string, overflow = false) => {
      nodes.push({ id, type: 'workspace', position: { x, y: at }, selected: !overflow && selection !== null && nodeKey(selection) === id,
        data: { kind: target.kind, target, label, caption, zh, onSelect: () => onSelect(target), menu: overflow ? undefined : menuFor(target), contextOnly: target.kind === 'task' && !overflow && !matchedIds.has(target.id), ...(expand ? { expanded: expanded.has(expand), onExpand: () => onExpand(expand) } : {}) },
        ariaLabel: `${label}, ${caption}`, selectable: true, draggable: false })
    }
    const link = (source: string, target: string) => edges.push({ id: `${source}/${target}`, source, target, type: 'default', style: { stroke: 'var(--workspace-edge)', strokeWidth: 1.3 }, selectable: false })
    const renderBranches = (branches: TaskBranch[], parentNode: string, parentTarget: Target, depth: number) => {
      const shown = branches.filter((branch, index) => index < 7 || retained.has(branch.task.id))
      for (const { task, children } of shown) {
        const start = y, id = `task:${task.id}`, target: Target = { kind: 'task', id: task.id }
        if (children.length && expanded.has(id)) renderBranches(children, id, target, depth + 1)
        if (y === start) y += 86
        const status = task.status === 'in-progress' ? (zh ? '进行中' : 'In progress') : task.status === 'done' ? (zh ? '已完成' : 'Completed') : task.status === 'cancelled' ? (zh ? '已取消' : 'Cancelled') : (zh ? '待办' : 'To do')
        const caption = [status, children.length ? `${children.length} ${zh ? '项子任务' : 'subtasks'}` : '', !matchedIds.has(task.id) ? (zh ? '父任务上下文' : 'Parent context') : ''].filter(Boolean).join(' · ')
        add(id, target, task.title, caption, 428 + depth * 214, (start + y - 86) / 2, children.length ? id : undefined)
        link(parentNode, id)
      }
      if (shown.length < branches.length) {
        const id = `more:${parentNode}`
        add(id, parentTarget, `+ ${branches.length - shown.length} ${zh ? '项任务' : 'tasks'}`, zh ? '选择后在列表中查看' : 'Select to view in the list', 428 + depth * 214, y, undefined, true)
        link(parentNode, id); y += 86
      }
    }
    for (const group of groups) {
      const start = y, projectNode = `project:${group.id}`
      if (expanded.has(projectNode)) {
        for (const topic of group.topics) {
          const topicStart = y, topicNode = `topic:${topic.id}`
          if (expanded.has(topicNode)) renderBranches(taskTree(topic.tasks), topicNode, { kind: 'topic', id: topic.id }, 0)
          if (y === topicStart) y += 86
          add(topicNode, { kind: 'topic', id: topic.id }, topic.name, `${topic.tasks.filter(task => matchedIds.has(task.id)).length} ${zh ? '项任务' : 'tasks'}`, 214, (topicStart + y - 86) / 2, topicNode)
          link(projectNode, topicNode); y += 20
        }
      }
      if (y === start) y += 86
      add(projectNode, { kind: 'project', id: group.id }, group.name, `${group.topics.length} ${zh ? '个主题' : 'topics'} · ${group.tasks.filter(task => matchedIds.has(task.id)).length} ${zh ? '项任务' : 'tasks'}`, 0, (start + y - 86) / 2, projectNode)
      y += 48
    }
    return { nodes, edges }
  }, [groups, expanded, selection, onExpand, onSelect, menuFor, matchedIds, zh])
  const selectedId = selection ? nodeKey(selection) : null
  useEffect(() => {
    if (!selectedId) return
    const timer = setTimeout(() => {
      const ids = new Set([selectedId])
      for (const group of groups) {
        if (selection?.kind === 'task') {
          const topic = group.topics.find(topic => topic.tasks.some(task => task.id === selection.id))
          const task = group.tasks.find(task => task.id === selection.id)
          const parent = task?.parentTaskId ? group.tasks.find(parent => parent.id === task.parentTaskId) : null
          // Deep ancestry remains available by panning and in the list path.
          // Focus the immediate relationship instead of shrinking five columns
          // of ancestors until task labels become unreadable in linked mode.
          if (parent) ids.add(`task:${parent.id}`)
          else if (topic) { ids.add(`project:${group.id}`); ids.add(`topic:${topic.id}`) }
        } else if (selection?.kind === 'topic' && group.topics.some(topic => topic.id === selection.id)) ids.add(`project:${group.id}`)
      }
      void flow.fitView({ nodes: [...ids].map(id => ({ id })), duration: reducedMotion ? 0 : 180, minZoom: 0.65, maxZoom: 1, padding: 0.06 })
    }, 50)
    return () => clearTimeout(timer)
  }, [selectedId, expanded, flow, reducedMotion, groups, selection])
  return <ReactFlow<GraphNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
    minZoom={0.15} maxZoom={1.4} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} deleteKeyCode={null} multiSelectionKeyCode={null} elementsSelectable
    onNodeClick={(_, node) => onSelect(node.data.target)} onNodeDoubleClick={(_, node) => node.data.onExpand?.()}
    onlyRenderVisibleElements={nodes.length > 200} proOptions={{ hideAttribution: false }} aria-label={zh ? '项目主题任务关系图' : 'Project topic task graph'}>
    <Controls showInteractive={false} />
  </ReactFlow>
}
export function WorkspaceGraph(props: Parameters<typeof Graph>[0]) { return <ReactFlowProvider><Graph {...props} /></ReactFlowProvider> }
