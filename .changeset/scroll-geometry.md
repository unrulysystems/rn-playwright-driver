---
'@unrulysystems/rn-playwright-driver': patch
---

`Locator.scrollIntoView` failures now state the stuck leading edge, the scroll that produced no movement, the element's bounds, the remaining distance, and the window metrics, so an intermittent boundary failure is diagnosable from the test log alone.
