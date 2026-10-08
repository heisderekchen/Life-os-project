import { afterEach, describe, expect, it } from 'vitest'
import { apiPath } from '@/lib/api/client'

const basePath = process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH

afterEach(() => {
  if (basePath === undefined) {
    delete process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH
  } else {
    process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH = basePath
  }
})

describe('apiPath', () => {
  it('prefixes root-relative API paths when Life OS is deployed under a subpath', () => {
    process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH = '/workbench'

    expect(apiPath('/api/tasks')).toBe('/workbench/api/tasks')
  })

  it('does not prefix a path that already contains the deployment subpath', () => {
    process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH = '/workbench'

    expect(apiPath('/workbench/api/tasks')).toBe('/workbench/api/tasks')
  })

  it('preserves paths when no public base path is configured', () => {
    delete process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH

    expect(apiPath('/api/tasks')).toBe('/api/tasks')
  })
})
