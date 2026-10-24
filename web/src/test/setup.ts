import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only cleans up automatically when test globals are on.
// Remembered choices (tab, theme, last visit) must not leak between tests.
afterEach(() => {
  cleanup()
  localStorage.clear()
})

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

// jsdom doesn't lay out, so it has no scrollIntoView (Rules and Filtered scroll to a linked rule).
Element.prototype.scrollIntoView ??= function () {}
