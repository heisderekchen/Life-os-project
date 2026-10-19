'use client'

import { useEffect, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Controls, Handle, Position, useReactFlow, type Node, type NodeProps, type Edge } from '@xyflow/react'
import { ChevronRight, FileText, Folder, Inbox, Layers } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { nodeKey, type WorkspaceGroup, type WorkspaceSelection } from './workspace-model'
import '@xyflow/react/dist/style.css'

type GraphData = { label: string; caption: string; kind: 'project' | 'topic' | 'task'; expanded?: boolean; onExpand?: () => void; target?: WorkspaceSelection; onSelect: () => void }
type GraphNode = Node<GraphData, 'workspace'>
function WorkspaceNode({ data, selected }: NodeProps<GraphNode>) {
  const Icon = data.kind === 'project' ? (data.label === '收件箱' || data.label === 'Inbox' ? Inbox : Folder) : data.kind === 'topic' ? Layers : FileText
  return <div className={`workspace-node ${selected ? 'is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="workspace-handle" />
    <button type="button" className="workspace-node-content nodrag nopan" onClick={event => { event.stopPropagation(); data.onSelect() }} aria-label={`${data.label}, ${data.caption}`} aria-pressed={selected}>
      <Icon size={18} aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={data.label}>{data.label}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{data.caption}</span></span>
    </button>
    {data.onExpand && <button type="button" className="workspace-expand nodrag nopan" aria-label={`${data.expanded ? '收起 / Collapse' : '展开 / Expand'} ${data.label}`} aria-expanded={data.expanded} onClick={event => { event.stopPropagation(); data.onExpand?.() }}><ChevronRight size={15} className={data.expanded ? 'rotate-90' : ''} /></button>}
    <Handle type="source" position={Position.Right} className="workspace-handle" />
  </div>
}
const nodeTypes = { workspace: WorkspaceNode }

function Graph({ groups, selection, expanded, onExpand, onSelect, zh }: {
  groups: WorkspaceGroup[]; selection: WorkspaceSelection; expanded: Set<string>; onExpand: (id: string) => void; onSelect: (selection: WorkspaceSelection) => void; zh: boolean
}) {
  const flow = useReactFlow<GraphNode>()
  const reducedMotion = useReducedMotion()
  const { nodes, edges } = useMemo(() => {
    const nodes: GraphNode[] = [], edges: Edge[] = []
    let y = 0
    const add = (id: string, kind: GraphData['kind'], label: string, caption: string, x: number, at: number, expand?: string) => {
      nodes.push({ id, type: 'workspace', position: { x, y: at }, selected: selection !== null && nodeKey(selection) === id,
        data: { kind, label, caption, onSelect: () => { const split = id.indexOf(':'); onSelect({ kind: id.slice(0, split) as GraphData['kind'], id: id.slice(split + 1) }) }, ...(expand ? { expanded: expanded.has(expand), onExpand: () => onExpand(expand) } : {}) },
        ariaLabel: `${label}, ${caption}`, selectable: true, draggable: false })
    }
    const link = (source: string, target: string) => edges.push({ id: `${source}/${target}`, source, target, type: 'default', style: { stroke: 'var(--workspace-edge)', strokeWidth: 1.3 }, selectable: false })
    for (const group of groups) {
      const start = y, projectNode = `project:${group.id}`
      if (expanded.has(projectNode)) {
        for (const topic of group.topics) {
          const topicStart = y, topicNode = `topic:${topic.id}`
          if (expanded.has(topicNode)) {
            const shown = topic.tasks.filter((task, index) => index < 7 || (selection?.kind === 'task' && selection.id === task.id))
            for (const task of shown) {
              add(`task:${task.id}`, 'task', task.title, task.status === 'in-progress' ? (zh ? '进行中' : 'In progress') : task.status === 'done' ? (zh ? '已完成' : 'Completed') : task.status === 'cancelled' ? (zh ? '已取消' : 'Cancelled') : (zh ? '待办' : 'To do'), 428, y)
              link(topicNode, `task:${task.id}`); y += 86
            }
            if (shown.length < topic.tasks.length) {
              const moreId = `more:${topic.id}`
              add(moreId, 'topic', `+ ${topic.tasks.length - shown.length} ${zh ? '项任务' : 'tasks'}`, zh ? '在列表中查看全部' : 'View all in the list', 428, y)
              nodes[nodes.length - 1].data.target = { kind: 'topic', id: topic.id }; nodes[nodes.length - 1].data.onSelect = () => onSelect({ kind: 'topic', id: topic.id })
              link(topicNode, moreId); y += 86
            }
          }
          if (y === topicStart) y += 86
          add(topicNode, 'topic', topic.name, `${topic.tasks.length} ${zh ? '项任务' : 'tasks'}`, 214, (topicStart + y - 86) / 2, topicNode)
          link(projectNode, topicNode); y += 20
        }
      }
      if (y === start) y += 86
      add(projectNode, 'project', group.name, `${group.topics.length} ${zh ? '个主题' : 'topics'} · ${group.tasks.length} ${zh ? '项任务' : 'tasks'}`, 0, (start + y - 86) / 2, projectNode)
      y += 48
    }
    return { nodes, edges }
  }, [groups, expanded, selection, onExpand, onSelect, zh])
  const selectedId = selection ? nodeKey(selection) : null
  useEffect(() => {
    if (!selectedId) return
    const timer = setTimeout(() => { void flow.fitView({ nodes: (() => { const ids = new Set([selectedId]); for (const group of groups) { if (selection?.kind === 'task') { const topic = group.topics.find(topic => topic.tasks.some(task => task.id === selection.id)); if (topic) { ids.add(`project:${group.id}`); ids.add(`topic:${topic.id}`) } } else if (selection?.kind === 'topic' && group.topics.some(topic => topic.id === selection.id)) ids.add(`project:${group.id}`) } return [...ids].map(id => ({ id })) })(), duration: reducedMotion ? 0 : 180, maxZoom: 1, padding: 0.06 }) }, 50)
    return () => clearTimeout(timer)
  }, [selectedId, expanded, flow, reducedMotion, groups, selection])
  return <ReactFlow<GraphNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
    minZoom={0.25} maxZoom={1.4} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} deleteKeyCode={null} multiSelectionKeyCode={null} elementsSelectable
    onNodeClick={(_, node) => { if (node.data.target) { onSelect(node.data.target); return } const split = node.id.indexOf(':'); onSelect({ kind: node.id.slice(0, split) as GraphData['kind'], id: node.id.slice(split + 1) }) }}
    onNodeDoubleClick={(_, node) => { if (node.data.onExpand) node.data.onExpand() }}
    onlyRenderVisibleElements={nodes.length > 200} proOptions={{ hideAttribution: false }} aria-label={zh ? '项目主题任务关系图' : 'Project topic task graph'}>
    <Controls showInteractive={false} />
  </ReactFlow>
}
export function WorkspaceGraph(props: Parameters<typeof Graph>[0]) { return <ReactFlowProvider><Graph {...props} /></ReactFlowProvider> }
