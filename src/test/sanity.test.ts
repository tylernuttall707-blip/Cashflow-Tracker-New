import { describe, it, expect } from 'vitest'

describe('Sanity Tests', () => {
  it('should pass a basic assertion', () => {
    expect(true).toBe(true)
  })

  it('should perform basic math correctly', () => {
    expect(1 + 1).toBe(2)
  })

  it('should have localStorage mock available', () => {
    expect(globalThis.localStorage).toBeDefined()
    globalThis.localStorage.setItem('test', 'value')
    expect(globalThis.localStorage.getItem('test')).toBe('value')
    globalThis.localStorage.clear()
  })
})
