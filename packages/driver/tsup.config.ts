import { defineConfig } from 'tsup'

export default defineConfig({
  // Main driver code (for Node.js)
  // Harness is shipped as source for Metro to bundle directly
  entry: {
    index: 'src/index.ts',
    test: 'src/test.ts',
    // Metro config helper: runs in the app's metro.config.js (Node), never in the bundle.
    metro: 'src/metro.ts',
    // Expo config plugin: runs in `expo prebuild` (Node) through app.plugin.js, never in the bundle.
    plugin: 'src/plugin.ts',
  },
  // metro.ts resolves the harness from __dirname; the shim keeps that valid in the ESM build.
  shims: true,
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
})
