import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MyOsHome } from '@/components/lifeos/myos/myos-home'

vi.mock('@/components/lifeos/myos/myos-overview', () => ({
  MyOsOverview: () => <div data-testid="myos-overview" />,
}))

afterEach(cleanup)

describe('MyOsHome', () => {
  it.each([
    ['mobile', 390],
    ['desktop', 1280],
  ])('keeps the home focused on myOS overview at %s width', (_device, width) => {
    window.innerWidth = width

    render(<MyOsHome />)

    expect(screen.getByTestId('myos-overview')).toBeInTheDocument()
    expect(screen.queryByText('个人生活图表与原有小组件')).not.toBeInTheDocument()
    expect(document.querySelector('details')).toBeNull()
  })
})
