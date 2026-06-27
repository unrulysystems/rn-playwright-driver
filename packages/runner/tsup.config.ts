import { defineConfig } from 'tsup'

export default defineConfig({
  // `index` is the library surface (defineRnDriverConfig + types).
  // `cli` is the runner entry the `rn-driver` bin loads from dist (the bin file
  // itself ships as a thin bun-run shim, mirroring the driver's rn-inspect bin).
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
})
