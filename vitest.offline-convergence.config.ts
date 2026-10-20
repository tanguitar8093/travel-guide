import { defineConfig } from 'vitest/config'

// Explicit offline scope; never load project .env files or unrelated suites.
export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    include: [
      'scripts/convergence-capture.test.mjs',
      'src/database/default-privileges-cloud.test.ts',
      'src/database/privilege-convergence-cloud.test.ts',
    ],
  },
})