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

    render(<MobileModuleDirectory category="productivity" onSelect={onSelect} />)

    expect(screen.getByRole('heading', { level: 1, name: '效率' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '效率' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '身心健康' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '成长' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '概览' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /任务/ }))
    expect(onSelect).toHaveBeenCalledWith('tasks')

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索功能' }), { target: { value: '日志' } })
    expect(screen.queryByRole('button', { name: /日志/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索功能' }), { target: { value: '笔记' } })
    expect(screen.getByRole('button', { name: /笔记/ })).toBeInTheDocument()
  })

  it('shows exactly four primary categories and only the browsed category as current', () => {
    useAppStore.setState({ language: 'zh' })
    render(<MobilePrimaryNav activeModule="dashboard" directoryOpen browseCategory="productivity" onCategory={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const current = within(nav).getAllByRole('button').filter(button => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('效率')
    expect(within(nav).getAllByRole('button').filter(button => button.className.includes('bg-accent'))).toHaveLength(1)
    expect(within(nav).getAllByRole('button')).toHaveLength(4)
    expect(within(nav).queryByRole('button', { name: '设置' })).not.toBeInTheDocument()
  })

  it('closes the category directory back to the current page', async () => {
    const onClose = vi.fn()
    useAppStore.setState({ language: 'zh' })
    render(<MobileModuleDirectory category="wellness" onSelect={vi.fn()} onClose={onClose} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '返回当前页面' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
