'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'

export type WorkspaceSplitKey = 'desktop' | 'stacked' | 'table' | 'focusDesktop' | 'focusTable'
type WorkspaceSizes = Record<WorkspaceSplitKey, number>

const STORAGE_KEY = 'myos-workspace-layout-v1'
const MIN = 25
const MAX = 75
const DEFAULTS: WorkspaceSizes = { desktop: 43, stacked: 42, table: 60, focusDesktop: 32, focusTable: 70 }
const KEYS: WorkspaceSplitKey[] = ['desktop', 'stacked', 'table', 'focusDesktop', 'focusTable']

export function revealWorkspaceSelection(container: HTMLElement, key: string) {
 const row = Array.from(container.querySelectorAll<HTMLElement>('[data-workspace-node]')).find(row => row.dataset.workspaceNode === key)
 if (!row || !container.clientHeight) return
 const bounds = container.getBoundingClientRect(), target = row.getBoundingClientRect()
 const top = bounds.top + container.clientTop + (container.querySelector('thead')?.getBoundingClientRect().height || 0)
 const bottom = bounds.top + container.clientTop + container.clientHeight
 if (target.top < top) container.scrollTop += target.top - top
 else if (target.bottom > bottom) container.scrollTop += target.bottom - bottom
}

function clampSize(value: number) {
 if (!Number.isFinite(value)) return MIN
 return Math.min(MAX, Math.max(MIN, value))
}

function readSizes(): WorkspaceSizes {
 const next = { ...DEFAULTS }
 try {
  if (typeof window === 'undefined') return next
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return next
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') return next
  for (const key of KEYS) {
   const candidate = (parsed as Record<string, unknown>)[key]
   if (typeof candidate === 'number' && Number.isFinite(candidate)) next[key] = clampSize(candidate)
  }
 } catch {}
 return next
}

function saveSizes(sizes: WorkspaceSizes) {
 try {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes))
 } catch {}
}

export function useWorkspaceLayout() {
 const [sizes, setSizes] = useState<WorkspaceSizes>({ ...DEFAULTS })
 const sizesRef = useRef(sizes)
 useEffect(() => {
  const saved = readSizes()
  sizesRef.current = saved
  setSizes(saved)
 }, [])
 const setSize = useCallback((key: WorkspaceSplitKey, value: number) => {
  const next = { ...sizesRef.current, [key]: clampSize(value) }
  sizesRef.current = next
  setSizes(next)
  saveSizes(next)
 }, [])
 return { sizes, setSize }
}

type WorkspaceResizeHandleProps = {
 axis: 'x' | 'y'
 value: number
 onChange: (value: number) => void
 containerRef: RefObject<HTMLElement | null>
 defaultValue: number
 label: string
 controls?: string
 className?: string
}

export function WorkspaceResizeHandle({ axis, value, onChange, containerRef, defaultValue, label, controls, className = '' }: WorkspaceResizeHandleProps) {
 const handleRef = useRef<HTMLDivElement>(null)
 const pointerIdRef = useRef<number | null>(null)
 const startRef = useRef({ pointer: 0, value: 0 })
 const [dragging, setDragging] = useState(false)
 const currentValue = clampSize(value)

 const stopDrag = useCallback(() => {
  const el = handleRef.current
  const id = pointerIdRef.current
  pointerIdRef.current = null
  try { if (el && id !== null && el.hasPointerCapture(id)) el.releasePointerCapture(id) } catch {}
  setDragging(false)
 }, [])

 useEffect(() => () => {
  const id = pointerIdRef.current
  pointerIdRef.current = null
  try { if (handleRef.current && id !== null) handleRef.current.releasePointerCapture(id) } catch {}
 }, [])

 const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
  if (event.button !== 0) return
  const rect = containerRef.current?.getBoundingClientRect()
  const length = axis === 'x' ? rect?.width : rect?.height
  if (!length || length <= 0) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.focus({ preventScroll: true })
  pointerIdRef.current = event.pointerId
  startRef.current = { pointer: axis === 'x' ? event.clientX : event.clientY, value: currentValue }
  setDragging(true)
  try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
 }

 const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
  if (pointerIdRef.current !== event.pointerId) return
  event.preventDefault()
  event.stopPropagation()
  const rect = containerRef.current?.getBoundingClientRect()
  const length = axis === 'x' ? rect?.width : rect?.height
  if (!length || length <= 0) return
  const point = axis === 'x' ? event.clientX : event.clientY
  onChange(clampSize(startRef.current.value + ((point - startRef.current.pointer) / length) * 100))
 }

 const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
  if (pointerIdRef.current !== event.pointerId) return
  event.preventDefault()
  event.stopPropagation()
  stopDrag()
 }

 const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
  const step = event.shiftKey ? 10 : 2
  let next = currentValue
  if (event.key === 'Home') next = MIN
  else if (event.key === 'End') next = MAX
  else if (axis === 'x' && event.key === 'ArrowLeft') next -= step
  else if (axis === 'x' && event.key === 'ArrowRight') next += step
  else if (axis === 'y' && event.key === 'ArrowUp') next -= step
  else if (axis === 'y' && event.key === 'ArrowDown') next += step
  else return
  event.preventDefault()
  event.stopPropagation()
  onChange(clampSize(next))
 }

 return (
  <div
   ref={handleRef}
   className={`workspace-resize workspace-resize-${axis}${dragging ? ' workspace-resize-dragging' : ''}${className ? ` ${className}` : ''}`}
   role='separator' tabIndex={0}
   aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
   aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={currentValue}
   aria-label={label} aria-controls={controls} title={label}
   data-dragging={dragging ? 'true' : 'false'} style={dragging ? { transition: 'none', animation: 'none' } : undefined}
   onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer}
   onPointerCancel={endPointer} onLostPointerCapture={endPointer} onKeyDown={onKeyDown}
   onDoubleClick={(event) => {
    event.preventDefault()
    event.stopPropagation()
    onChange(clampSize(defaultValue))
   }}
  />
 )
}
