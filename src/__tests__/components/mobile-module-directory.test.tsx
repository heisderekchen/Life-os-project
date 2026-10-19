import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '@/stores/app-store'
import { MobileModuleDirectory } from '@/components/lifeos/mobile-module-directory'
import { MobilePrimaryNav } from '@/components/lifeos/app-shell'

describe('mobile module directory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('organizes available tools by intent and opens the selected module', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    useAppStore.setState({ language: 'zh', enabledModules: ['dashboard', 'tasks', 'projects', 'notes', 'calendar', 'time', 'habits', 'journal', 'goals', 'learning', 'finance'] })

    render(<MobileModuleDirectory category="apps" onSelect={onSelect} />)

    expect(screen.getByRole('heading', { level: 1, name: '应用与渠道' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '应用与渠道' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '身心健康' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '成长' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '总览' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /任务/ }))
    expect(onSelect).toHaveBeenCalledWith('projects')

    fireEvent.change(screen.getByRole('searchbox', { name: '查找应用' }), { target: { value: '日志' } })
    expect(screen.getByRole('button', { name: /日志/ })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '查找应用' }), { target: { value: '笔记' } })
    expect(screen.getByRole('button', { name: /笔记/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /日志/ })).not.toBeInTheDocument()
  })

  it('shows the four myOS destinations and marks the current page', () => {
    useAppStore.setState({ language: 'zh' })
    render(<MobilePrimaryNav activeModule="dashboard" onNavigate={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const current = within(nav).getAllByRole('button').filter(button => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('总览')
    expect(within(nav).getAllByRole('button').filter(button => button.className.includes('bg-accent'))).toHaveLength(1)
    expect(within(nav).getAllByRole('button')).toHaveLength(4)
    expect(within(nav).getByRole('button', { name: '提醒' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: '任务' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: '我的' })).toBeInTheDocument()
  })

  it('navigates directly to reminders from the mobile primary nav', async () => {
    const onNavigate = vi.fn()
    useAppStore.setState({ language: 'zh' })
    render(<MobilePrimaryNav activeModule="dashboard" onNavigate={onNavigate} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '提醒' }))
    expect(onNavigate).toHaveBeenCalledWith('reminders')
  })

  it('closes the category directory back to the current page', async () => {
    const onClose = vi.fn()
    useAppStore.setState({ language: 'zh' })
    render(<MobileModuleDirectory category="apps" onSelect={vi.fn()} onClose={onClose} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '返回当前页面' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('localizes directory helper text and search labels', () => {
    useAppStore.setState({ language: 'en' })
    render(<MobileModuleDirectory category="apps" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Choose a tool based on what you want to do next.')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Find apps' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to current page' })).toBeInTheDocument()
  })
})
