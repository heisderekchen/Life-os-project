import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MyOsPage } from '@/components/lifeos/myos/myos-page'

const setActiveModule = vi.fn()

vi.mock('@/lib/api/hooks', () => ({ useProfile: () => ({ data: { name: '测试用户' } }) }))
vi.mock('@/stores/app-store', () => ({ useAppStore: (selector: (state: { setActiveModule: typeof setActiveModule }) => unknown) => selector({ setActiveModule }) }))
vi.mock('@/components/lifeos/myos/workspace-switcher', () => ({ GrantedWorkspaceList: () => <div /> }))

afterEach(() => {
  cleanup()
  setActiveModule.mockClear()
})

describe('MyOsPage', () => {
  it('exposes fitness from the mobile myOS module grid', () => {
    render(<MyOsPage />)

    fireEvent.click(screen.getByRole('button', { name: '健身' }))

    expect(setActiveModule).toHaveBeenCalledWith('fitness')
  })
})
