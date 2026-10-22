import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FocusModeOverlay } from '@/components/lifeos/focus-mode-overlay'
import { useAppStore } from '@/stores/app-store'

afterEach(() => { cleanup(); useAppStore.setState({ focusMode: false }) })

describe('focus mode controls', () => {
  it('shows the current project module and keeps an immediate exit available', () => {
    useAppStore.setState({ focusMode: true, activeModule: 'projects', language: 'en' })
    render(<FocusModeOverlay />)
    expect(screen.getByRole('toolbar', { name: 'Focus Mode' })).toHaveTextContent('Projects')
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Exit Focus/ }))
    expect(useAppStore.getState().focusMode).toBe(false)
  })
})
