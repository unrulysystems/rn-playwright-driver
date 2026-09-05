---
'@unrulysystems/rn-playwright-driver-runner': minor
---

The runner sets `RN_E2E=1` on every `expo prebuild` it plans and every Metro it starts, the marker the driver's Metro helper and every config plugin in this repository key off. The Android Hermes-target wait now retries with a warm `am start` (no `force-stop`), so a registration in flight survives the retry instead of being discarded on every attempt.
