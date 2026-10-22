import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { WorkspaceResizeHandle, useWorkspaceLayout, revealWorkspaceSelection } from '@/components/lifeos/projects/workspace-resize'

function Harness({ axis = 'x' as 'x' | 'y' }) {
  const { sizes, setSize } = useWorkspaceLayout()
  const containerRef = useRef<HTMLDivElement>(null)
  return <div ref={containerRef} data-testid="container"><WorkspaceResizeHandle axis={axis} value={sizes.desktop} onChange={value => setSize('desktop', value)} containerRef={containerRef} defaultValue={43} label="调整测试面板" controls="first second" /><output>{sizes.table}</output></div>
}
const pointer = (element: HTMLElement, type: string, id: number, x: number) => fireEvent(element, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: id, button: 0, clientX: x, clientY: x }))
beforeEach(() => { vi.mocked(localStorage.getItem).mockReset().mockReturnValue(null); vi.mocked(localStorage.setItem).mockReset() })
afterEach(() => cleanup())

describe('workspace split controls', () => {
  it('keeps a selected row between the sticky table header and resized bottom edge', () => {
    const container = document.createElement('div')
    container.innerHTML = '<table><thead></thead><tbody><tr data-workspace-node="project:last"><td>Last project</td></tr></tbody></table>'
    let height = 240
    Object.defineProperty(container, 'clientHeight', { get: () => height })
    container.getBoundingClientRect = () => ({ top: 100 } as DOMRect)
    container.querySelector('thead')!.getBoundingClientRect = () => ({ height: 42 } as DOMRect)
    container.querySelector('tr')!.getBoundingClientRect = () => ({ top: 450 - container.scrollTop, bottom: 493 - container.scrollTop } as DOMRect)
    revealWorkspaceSelection(container, 'project:last')
    expect(container.scrollTop).toBe(153)
    height = 120
    revealWorkspaceSelection(container, 'project:last')
    expect(container.scrollTop).toBe(273)
    container.scrollTop = 320
    revealWorkspaceSelection(container, 'project:last')
    expect(container.scrollTop).toBe(308)
    revealWorkspaceSelection(container, 'project:last')
    expect(container.scrollTop).toBe(308)
    revealWorkspaceSelection(container, 'task:missing')
    expect(container.scrollTop).toBe(308)
  })
  it('supports bounded keyboard resizing, axis semantics, reset, and immediate persistence', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: '调整测试面板' })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    fireEvent.keyDown(handle, { key: 'ArrowRight' }); expect(handle).toHaveAttribute('aria-valuenow', '45')
    fireEvent.keyDown(handle, { key: 'ArrowUp' }); expect(handle).toHaveAttribute('aria-valuenow', '45')
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true }); expect(handle).toHaveAttribute('aria-valuenow', '35')
    fireEvent.keyDown(handle, { key: 'End' }); fireEvent.keyDown(handle, { key: 'ArrowRight' }); expect(handle).toHaveAttribute('aria-valuenow', '75')
    fireEvent.keyDown(handle, { key: 'Home' }); fireEvent.keyDown(handle, { key: 'ArrowLeft' }); expect(handle).toHaveAttribute('aria-valuenow', '25')
    fireEvent.doubleClick(handle); expect(handle).toHaveAttribute('aria-valuenow', '43')
    const saved = JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])
    expect(saved).toEqual({ desktop: 43, stacked: 42, table: 60, focusDesktop: 32, focusTable: 70 })
  })
  it('loads validated browser dimensions without overwriting them during hydration', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ desktop: 61, stacked: 'bad', table: 37 }))
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '61'))
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(localStorage.setItem).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    expect(JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])).toEqual({ desktop: 63, stacked: 42, table: 37, focusDesktop: 32, focusTable: 70 })
  })
  it('works when browser storage is unavailable', () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('blocked') })
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('blocked') })
    render(<Harness axis="y" />)
    const handle = screen.getByRole('separator')
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    fireEvent.keyDown(handle, { key: 'ArrowDown' }); expect(handle).toHaveAttribute('aria-valuenow', '45')
  })
  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('tracks only the captured pointer and cleans up after %s', type => {
    render(<Harness />)
    const handle = screen.getByRole('separator')
    vi.spyOn(screen.getByTestId('container'), 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 600 } as DOMRect)
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() })
    pointer(handle, 'pointerdown', 1, 100)
    expect(handle).toHaveAttribute('data-dragging', 'true')
    pointer(handle, 'pointermove', 2, 300); expect(handle).toHaveAttribute('aria-valuenow', '43')
    pointer(handle, 'pointermove', 1, 300); expect(handle).toHaveAttribute('aria-valuenow', '63')
    pointer(handle, type, 1, 300); expect(handle).toHaveAttribute('data-dragging', 'false')
    pointer(handle, 'pointermove', 1, 400); expect(handle).toHaveAttribute('aria-valuenow', '63')
  })
})
