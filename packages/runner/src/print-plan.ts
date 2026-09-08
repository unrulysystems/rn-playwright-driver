import type {
  CleanupAction,
  CommandSpec,
  FreePortSpec,
  Plan,
  PortOwner,
  ReadinessProbe,
  StepAction,
} from './plan/types'

/**
 * Render a {@link Plan} as auditable text for `--dry-run`. Token material appears
 * only as the placeholder file path (dry-run resolution fills `tokenFile` with
 * `<token-file>`), so this output never leaks a secret value.
 */
export function renderPlan(plan: Plan): string {
  const lines: string[] = []
  lines.push(`Plan (${plan.platform}) — ${plan.steps.length} steps`)
  for (const step of plan.steps) {
    const tag = `[${step.stage}]`.padEnd(15)
    const skip = step.skippable ? ' (skip-build: skipped)' : ''
    lines.push(`  ${tag}${step.id} — ${step.description}${skip}`)
    lines.push(`      ${renderAction(step.action)}`)
  }

  lines.push('')
  lines.push('Driver env (handed to Playwright):')
  for (const [key, value] of Object.entries(plan.driverEnv)) {
    lines.push(`  ${key}=${value}`)
  }

  lines.push('')
  lines.push('Playwright:')
  lines.push(`  ${renderCommand(plan.playwright)}`)

  lines.push('')
  lines.push('Cleanup (defensive, idempotent):')
  for (const action of plan.cleanup) {
    lines.push(`  - ${action.description}: ${renderCleanup(action)}`)
  }

  return lines.join('\n')
}

/** Ownership scope is what the free DOES, so the audited plan shows it (REQ-OWN-005). */
function renderFreePort(spec: FreePortSpec): string {
  const owner = renderOwner(spec.owner)
  const force = spec.freeUnowned ? ', freeUnownedPort: kills any holder' : ''
  return `free-port ${spec.port} (owner: ${owner}${force})`
}

function renderOwner(owner: PortOwner): string {
  if (owner.platform === 'android') return `android ${owner.serial}`
  return owner.kind === 'simulator'
    ? `ios simulator ${owner.simUdid} (${owner.runnerExecutable})`
    : `ios device ${owner.serial}`
}

function renderAction(action: StepAction): string {
  switch (action.type) {
    case 'command':
      return `${action.background ? 'spawn ' : '$ '}${renderCommand(action.command)}${action.allowFailure ? '  (best-effort)' : ''}`
    case 'write-file':
      return `write ${action.path}${action.mode ? ` (mode ${action.mode.toString(8)})` : ''}`
    case 'copy-file':
      return `copy ${action.from} -> ${action.to}${action.mode ? ` (mode ${action.mode.toString(8)})` : ''}`
    case 'free-port':
      return renderFreePort(action.spec)
    case 'install-ios-app':
      return `install-ios-app ${action.spec.scheme} -> ${action.spec.target.kind} ${action.spec.target.udid}  (product from xcodebuild -showBuildSettings)`
    case 'seed-ios-defaults': {
      const entries = action.spec.entries.map((e) => `${e.key}=${String(e.value)}`).join(' ')
      return `seed-ios-defaults ${action.spec.bundleId} on ${action.spec.udid}: ${entries}  (app-container plist)`
    }
    case 'probe': {
      // Fast-fail markers change what the probe DOES (abort early instead of waiting out the
      // timeout), so the audited dry-run plan must show them to stay faithful (REQ-CLI-002,
      // REQ-DIAG-003, BRIEF "Faithfulness").
      const fastFail = action.failureMarkers?.length
        ? ` [fast-fail on: ${action.failureMarkers.join(', ')}]`
        : ''
      return `probe ${renderProbe(action.probe)}${fastFail}`
    }
    default: {
      const _exhaustive: never = action
      throw new Error(`unhandled action: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function renderCleanup(action: CleanupAction): string {
  switch (action.type) {
    case 'kill-process':
      return `kill ${action.processKey}`
    case 'free-port':
      return renderFreePort(action.spec)
    case 'remove-file':
      return `rm ${action.path}`
    case 'command':
      return `$ ${renderCommand(action.command)}`
    default: {
      const _exhaustive: never = action
      throw new Error(`unhandled cleanup: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function renderCommand(command: CommandSpec): string {
  const envEntries = [
    ...Object.entries(command.appendEnv ?? {}).map(([k, v]) => `${k}+=${v}`),
    ...Object.entries(command.env ?? {}).map(([k, v]) => `${k}=${v}`),
  ]
  const env = envEntries.length > 0 ? `${envEntries.join(' ')} ` : ''
  const packageBin = command.packageBin ? ' [package-bin]' : ''
  const stdin = command.stdinFromFile
    ? ` < ${command.stdinFromFile}`
    : command.stdinContents
      ? ' < <stdin>'
      : ''
  const cwd = command.cwd ? ` (cwd: ${command.cwd})` : ''
  return `${env}${command.command} ${command.args.join(' ')}${packageBin}${stdin}${cwd}`.trim()
}

function renderProbe(probe: ReadinessProbe): string {
  switch (probe.kind) {
    case 'metro-status':
      return `metro-status ${probe.metroUrl} (≤${probe.timeoutMs}ms)`
    case 'hermes-target':
      return `hermes-target ${probe.appId}${probe.deviceNameMatch ? ` @ ${probe.deviceNameMatch}` : ''} (≤${probe.timeoutMs}ms)`
    case 'xctest-hello':
      return `xctest-hello :${probe.port} (≤${probe.timeoutMs}ms)`
    case 'instrumentation-hello':
      return `instrumentation-hello :${probe.port} (≤${probe.timeoutMs}ms)`
    default: {
      const _exhaustive: never = probe
      throw new Error(`unhandled probe: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
