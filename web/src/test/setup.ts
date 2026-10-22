import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only cleans up automatically when test globals are on.
afterEach(() => cleanup())

// antd measures elements with ResizeObserver, which jsdom doesn't have.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// antd's responsive layout reads matchMedia, which jsdom doesn't have either.
// Tests render as a wide desktop screen: every min-width breakpoint matches.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
