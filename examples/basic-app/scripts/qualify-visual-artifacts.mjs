#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const DEFAULT_MANIFEST = 'test-results/visual-judge/latest/manifest.json'

const manifestPath = resolve(process.argv[2] ?? DEFAULT_MANIFEST)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const artifactRoot = isAbsolute(manifest.artifactRoot)
  ? manifest.artifactRoot
  : resolve(dirname(manifestPath), manifest.artifactRoot)
const packetDir = join(artifactRoot, 'blind-judge-packets')

mkdirSync(packetDir, { recursive: true })

const failures = []
const qualified = []

for (const capture of manifest.captures ?? []) {
  const screenshotPath = resolve(artifactRoot, capture.screenshot)
  const statePath = resolve(artifactRoot, capture.state)
  const screenshot = readFileSync(screenshotPath)
  const png = decodePng(screenshot)
  const stats = imageStats(png)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  const result = qualifyImage(capture, screenshot, png, stats, state)

  qualified.push({
    id: capture.id,
    screenshot: screenshotPath,
    state: statePath,
    dimensions: { width: png.width, height: png.height },
    stats,
    result,
  })

  const packet = buildJudgePacket({
    capture,
    screenshotPath,
    statePath,
    png,
    stats,
    result,
  })
  writeFileSync(join(packetDir, `${capture.id}.md`), packet)

  if (!result.pass) {
    failures.push(`${capture.id}: ${result.reasons.join('; ')}`)
  }
}

const report = {
  schemaVersion: 1,
  manifest: manifestPath,
  generatedAt: new Date().toISOString(),
  packetDir,
  qualified,
  status: failures.length === 0 ? 'passed' : 'failed',
  failures,
}

const reportPath = join(artifactRoot, 'qualification-report.json')
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`Visual qualification failed:\n- ${failures.join('\n- ')}`)
  console.error(`Report: ${reportPath}`)
  process.exit(1)
}

console.log(`Visual qualification passed for ${qualified.length} screenshots.`)
console.log(`Report: ${reportPath}`)
console.log(`Blind judge packets: ${packetDir}`)

function qualifyImage(capture, screenshot, png, stats, state) {
  const reasons = []
  const actualHash = createHash('sha256').update(screenshot).digest('hex')

  if (capture.pngSha256 && capture.pngSha256 !== actualHash) {
    reasons.push('PNG sha256 does not match manifest')
  }
  if (capture.pngSize) {
    if (capture.pngSize.width !== png.width || capture.pngSize.height !== png.height) {
      reasons.push(
        `PNG dimensions do not match manifest (${png.width}x${png.height} actual, ${capture.pngSize.width}x${capture.pngSize.height} manifest)`,
      )
    }
  }
  if (png.width < 200 || png.height < 200) {
    reasons.push(`image dimensions are too small (${png.width}x${png.height})`)
  }
  if (stats.uniqueSampledColors < 16) {
    reasons.push(`too few sampled colors (${stats.uniqueSampledColors})`)
  }
  if (stats.luminanceStdDev < 8) {
    reasons.push(`low luminance variance (${stats.luminanceStdDev.toFixed(2)})`)
  }
  if (stats.nonWhiteRatio < 0.02) {
    reasons.push(`mostly white (${(stats.nonWhiteRatio * 100).toFixed(2)}% non-white)`)
  }
  if (stats.nonBlackRatio < 0.02) {
    reasons.push(`mostly black (${(stats.nonBlackRatio * 100).toFixed(2)}% non-black)`)
  }
  if (!state.countDisplay?.success) {
    reasons.push('count-display was not present in paired state JSON')
  }
  if (capture.id.includes('final') && state.countDisplay?.success) {
    const text = state.countDisplay.data.text ?? ''
    if (!text.includes('Count: 0')) {
      reasons.push(`final state expected Count: 0, got ${JSON.stringify(text)}`)
    }
  }

  return { pass: reasons.length === 0, reasons }
}

function buildJudgePacket({ capture, screenshotPath, statePath, png, stats, result }) {
  return [
    `# Blind Visual Judge Packet: ${capture.id}`,
    '',
    'You are a blind independent visual judge for the React Native Playwright driver example.',
    'Judge only the provided screenshot and paired state JSON. Do not rely on prior conversation, live device watching, or test pass/fail status.',
    '',
    '## Verdict Contract',
    '',
    'Return exactly one verdict line: `APPROVE` or `REJECT`, then concise reasons.',
    '',
    'Reject if the screenshot is blank, mostly white/black, shows Expo/dev-client menus, native error overlays, stale/non-counter content, clipped/illegible UI, or contradicts the paired state JSON.',
    '',
    '## Artifact',
    '',
    `- Screenshot: ${screenshotPath}`,
    `- State JSON: ${statePath}`,
    `- Dimensions: ${png.width}x${png.height}`,
    `- PNG SHA-256: ${capture.pngSha256 ?? 'not recorded'}`,
    `- Window metrics: ${JSON.stringify(capture.windowMetrics ?? null)}`,
    `- Deterministic qualification: ${result.pass ? 'PASS' : 'FAIL'}`,
    `- Deterministic stats: ${JSON.stringify(stats)}`,
    `- Test file: ${capture.testFile ?? 'unknown'}`,
    `- Test title: ${capture.testTitle ?? 'unknown'}`,
    `- Capture API: ${capture.api ?? 'unknown'}`,
    '',
    '## Expected State',
    '',
    capture.expectation,
    '',
    '## Description',
    '',
    capture.description,
    '',
    '## Pass Criteria',
    '',
    ...(capture.passCriteria ?? []).map((item) => `- ${item}`),
    '',
    '## Fail Criteria',
    '',
    ...(capture.failCriteria ?? []).map((item) => `- ${item}`),
    '',
  ].join('\n')
}

function decodePng(buffer) {
  assertPngSignature(buffer)

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const data = buffer.subarray(dataStart, dataEnd)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset = dataEnd + 4
  }

  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth}; expected 8 or 16`)
  }
  if (interlace !== 0) {
    throw new Error('Unsupported interlaced PNG')
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (channels === 0) {
    throw new Error(`Unsupported PNG color type ${colorType}; expected RGB or RGBA`)
  }

  const bytesPerSample = bitDepth / 8
  const bytesPerPixel = channels * bytesPerSample
  const inflated = inflateSync(Buffer.concat(idat))
  const stride = width * bytesPerPixel
  const pixels = Buffer.alloc(width * height * 4)
  let src = 0
  let prev = Buffer.alloc(stride)

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src]
    src += 1
    const row = Buffer.from(inflated.subarray(src, src + stride))
    src += stride
    unfilterRow(row, prev, channels, filter)

    for (let x = 0; x < width; x += 1) {
      const rowIndex = x * bytesPerPixel
      const pixelIndex = (y * width + x) * 4
      pixels[pixelIndex] = sampleToByte(row, rowIndex, bytesPerSample)
      pixels[pixelIndex + 1] = sampleToByte(row, rowIndex + bytesPerSample, bytesPerSample)
      pixels[pixelIndex + 2] = sampleToByte(row, rowIndex + bytesPerSample * 2, bytesPerSample)
      pixels[pixelIndex + 3] =
        channels === 4 ? sampleToByte(row, rowIndex + bytesPerSample * 3, bytesPerSample) : 255
    }
    prev = row
  }

  return { width, height, pixels }
}

function assertPngSignature(buffer) {
  const expected = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < expected.length; i += 1) {
    if (buffer[i] !== expected[i]) {
      throw new Error('Invalid PNG signature')
    }
  }
}

function sampleToByte(row, offset, bytesPerSample) {
  return bytesPerSample === 1 ? row[offset] : row[offset]
}

function unfilterRow(row, prev, bytesPerPixel, filter) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0
    const up = prev[i] ?? 0
    const upLeft = i >= bytesPerPixel ? (prev[i - bytesPerPixel] ?? 0) : 0
    if (filter === 1) {
      row[i] = (row[i] + left) & 0xff
    } else if (filter === 2) {
      row[i] = (row[i] + up) & 0xff
    } else if (filter === 3) {
      row[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff
    } else if (filter === 4) {
      row[i] = (row[i] + paeth(left, up, upLeft)) & 0xff
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter ${filter}`)
    }
  }
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return up
  return upLeft
}

function imageStats({ width, height, pixels }) {
  const sampleEvery = Math.max(1, Math.floor((width * height) / 20_000))
  let sampled = 0
  let luminanceSum = 0
  let luminanceSquares = 0
  let nonWhite = 0
  let nonBlack = 0
  const colors = new Set()

  for (let pixel = 0; pixel < width * height; pixel += sampleEvery) {
    const index = pixel * 4
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sampled += 1
    luminanceSum += luma
    luminanceSquares += luma * luma
    if (!(r > 245 && g > 245 && b > 245)) nonWhite += 1
    if (!(r < 10 && g < 10 && b < 10)) nonBlack += 1
    colors.add(`${r >> 4},${g >> 4},${b >> 4}`)
  }

  const mean = luminanceSum / sampled
  const variance = Math.max(0, luminanceSquares / sampled - mean * mean)

  return {
    sampledPixels: sampled,
    uniqueSampledColors: colors.size,
    luminanceMean: Number(mean.toFixed(2)),
    luminanceStdDev: Number(Math.sqrt(variance).toFixed(2)),
    nonWhiteRatio: Number((nonWhite / sampled).toFixed(4)),
    nonBlackRatio: Number((nonBlack / sampled).toFixed(4)),
  }
}
