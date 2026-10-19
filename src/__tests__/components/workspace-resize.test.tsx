import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { WorkspaceResizeHandle, useWorkspaceLayout } from '@/components/lifeos/projects/workspace-resize'

function Harness({ axis = 'x' as 'x' | 'y' }) {
  const { sizes, setSize } = useWorkspaceLayout()
  const containerRef = useRef<HTMLDivElement>(null)
  return <div ref={containerRef} data-testid="container"><WorkspaceResizeHandle axis={axis} value={sizes.desktop} onChange={value => setSize('desktop', value)} containerRef={containerRef} defaultValue={43} label="调整测试面板" controls="first second" /><output>{sizes.table}</output></div>
}
const pointer = (element: HTMLElement, type: string, id: number, x: number) => fireEvent(element, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: id, button: 0, clientX: x, clientY: x }))
beforeEach(() => { vi.mocked(localStorage.getItem).mockReset().mockReturnValue(null); vi.mocked(localStorage.setItem).mockReset() })
afterEach(() => cleanup())

describe('workspace split controls', () => {
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
    expect(saved).toEqual({ desktop: 43, stacked: 42, table: 60 })
  })
  it('loads validated browser dimensions without overwriting them during hydration', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ desktop: 61, stacked: 'bad', table: 37 }))
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '61'))
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(localStorage.setItem).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    expect(JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1])).toEqual({ desktop: 63, stacked: 42, table: 37 })
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
