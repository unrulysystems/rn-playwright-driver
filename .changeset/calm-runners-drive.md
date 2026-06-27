---
'@unrulysystems/rn-playwright-driver': patch
'@unrulysystems/rn-playwright-driver-runner': patch
---

Harden the runner and driver fixtures for dev-client dogfooding.

The runner now ships a Node-compatible `rn-driver` bin, supports Android
Expo dev-client deep-link launch, and documents runner-owned lifecycle
boundaries. The driver Playwright fixture resolves `@playwright/test` from the
consumer project so npm and Yarn installs use the app's Playwright instance.
