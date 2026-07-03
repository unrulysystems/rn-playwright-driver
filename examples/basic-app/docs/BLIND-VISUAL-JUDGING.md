# Blind Visual Judging

The example e2e gate must produce visual evidence that can be judged without
watching the device. A passing driver/API assertion is not enough: a blank
screen, Expo dev-client menu, native error overlay, or stale page must fail the
visual gate.

## Artifact Contract

The physical iOS visual spec writes artifacts under:

```text
test-results/visual-judge/latest/
```

Each run produces:

- `manifest.json` - capture list, expectations, and paired state JSON paths.
- `manifest.json.captures[*].pngSha256` - hash of the exact screenshot bytes.
- `manifest.json.captures[*].pngSize` and `windowMetrics` - host/device context
  for judging crop and scale.
- `*.png` - full-device screenshots from the in-app screenshot native module.
- `*.state.json` - view-tree state captured at the same point as each PNG.
- `qualification-report.json` - deterministic PNG qualification output.
- `blind-judge-packets/*.md` - one prompt packet per screenshot for subagents.

The manifest is the source of truth for blind judging. Judges should only use
the screenshot, paired state JSON, and the expectation written in that manifest.

## Run

From `examples/basic-app`:

```bash
nub exec rn-driver test --platform ios --config rn-driver.ios-device.config.ts --device <ios-udid-or-device-name>
nub run judge:visual
```

`qualify-visual-artifacts.mjs` is the deterministic floor. It decodes each PNG
without external services, checks dimensions, color diversity, luminance
variance, non-white/non-black ratio, PNG hash/dimension agreement with the
manifest, and paired state JSON. If it fails, do not send the artifact to
subjective judges as a pass candidate.

## Blind Subagent Judges

After deterministic qualification passes, spawn at least two independent
subagents. Give each judge the relevant `blind-judge-packets/*.md`, its PNG, and
its paired state JSON. Judges must not know whether the e2e run passed.

Judge prompt contract:

```text
You are an independent blind visual judge for rn-playwright-driver examples.
Judge only the attached screenshot, paired state JSON, and packet expectation.
Return exactly one verdict line: APPROVE or REJECT, then concise reasons.
Reject blank screens, mostly white/black screens, Expo/dev-client menus, native
error overlays, stale/non-counter content, clipped/illegible UI, or screenshots
that contradict the state JSON.
```

The visual gate passes only when:

- the e2e command exits 0;
- deterministic qualification exits 0;
- every required screenshot has at least two independent `APPROVE` verdicts;
- no judge reports a blank/stale/error screen.

If judges disagree, treat the visual gate as failed and inspect the named
screenshot. Do not average the verdicts.
