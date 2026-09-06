---
'@unrulysystems/rn-playwright-driver-runner': patch
---

The root README's canonical runner-config example carried `launch: { mode: 'attach', kind: 'plain' }`, which the runner's own validator rejects (`mode "attach" requires kind "expo-dev-client"`). A consumer copying the one config the CLI requires them to write hit exit 2, while the runner README documented the correct `mode: 'launch'` two files away. The example is corrected, and a new test extracts every complete `defineRnDriverConfig` block from the shipped markdown and runs it through `assertValid`, so a documented example can no longer disagree with the validator.
