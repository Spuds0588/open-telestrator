import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Every test target is pure logic (no DOM needed); the browser-facing
    // behaviour is verified end-to-end against the built app instead.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
