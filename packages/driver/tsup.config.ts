import { defineConfig } from 'tsup'

export default defineConfig({
  // Main driver code (for Node.js)
  // Harness is shipped as source for Metro to bundle directly
  entry: {
    index: 'src/index.ts',
    test: 'src/test.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
})
