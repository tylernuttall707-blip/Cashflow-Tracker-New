// Future: Add React testing library cleanup when we have React components
// import { cleanup } from '@testing-library/react'
// import { afterEach } from 'vitest'
// afterEach(() => {
//   cleanup()
// })

// Extend Vitest's expect method with custom matchers if needed
// Example: expect.extend({ ... })

// Mock localStorage for tests
interface LocalStorageMock {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

const localStorageMock: LocalStorageMock = (() => {
  let store: Record<string, string> = {}

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

;(globalThis as any).localStorage = localStorageMock as Storage
