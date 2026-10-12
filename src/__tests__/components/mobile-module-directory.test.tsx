import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppStore } from '@/stores/app-store'
import { MobileModuleDirectory } from '@/components/lifeos/mobile-module-directory'

describe('mobile module directory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('organizes available tools by intent and opens the selected module', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    useAppStore.setState({ language: 'zh', enabledModules: ['dashboard', 'tasks', 'projects', 'notes', 'calendar', 'time', 'habits', 'journal', 'goals', 'learning', 'finance'] })

    render(<MobileModuleDirectory onSelect={onSelect} />)

    expect(screen.getByRole('heading', { name: '接下来要去哪里？' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '常用' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '工作' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '生活' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '设置' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /任务/ }))
    expect(onSelect).toHaveBeenCalledWith('tasks')

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索功能' }), { target: { value: '日志' } })
    expect(screen.getByRole('button', { name: /日志/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /笔记/ })).not.toBeInTheDocument()
  })
})
