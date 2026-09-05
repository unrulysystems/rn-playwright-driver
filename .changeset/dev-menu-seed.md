---
'@unrulysystems/rn-playwright-driver-runner': minor
---

iOS `NSUserDefaults` seeds (`RCT_jsLocation`, `ios.defaults`) are written into the app's data container after the install; `simctl spawn defaults write <bundleId>` had been writing a simulator-wide domain the sandboxed app never read, and the step now fails the run instead of being best-effort (REQ-IOS-005, REQ-IOS-010). Dev-client apps get the expo-dev-menu onboarding seeds on both platforms (`ios.dev-menu`, `android.dev-menu`): the menu used to open over the app at launch and take the suite's first tap (REQ-IOS-016, REQ-AND-010).
