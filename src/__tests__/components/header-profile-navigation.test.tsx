import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '@/stores/app-store'
import { Header } from '@/components/lifeos/header'

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }) }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))
vi.mock('@/lib/api/hooks', () => ({ useProfile: () => ({ data: { name: 'Preview User', email: 'preview@example.test' } }) }))
vi.mock('@/components/lifeos/notification-center', () => ({ NotificationCenter: () => null }))

describe('mobile profile navigation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps Settings directly reachable from the header profile menu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    useAppStore.setState({ language: 'zh', activeModule: 'tasks', mobileSidebarOpen: true })
    const user = userEvent.setup()
    render(<Header />)

    await user.click(screen.getByRole('button', { name: '个人资料' }))
    await user.click(await screen.findByRole('menuitem', { name: /偏好设置/ }))

    expect(useAppStore.getState().activeModule).toBe('settings')
    expect(useAppStore.getState().mobileSidebarOpen).toBe(false)
  })
})
