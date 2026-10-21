import { defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    include: [
      'poc/public-itinerary-sharing/**/*.test.ts',
      'poc/public-itinerary-sharing/**/*.contract.ts',
    ],
  },
})
