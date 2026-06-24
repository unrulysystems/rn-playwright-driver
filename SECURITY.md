# Security Policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public issue, pull
request, or discussion for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository:
**Security → Advisories → Report a vulnerability**. This opens a private channel
with the maintainers.

When reporting, include:

- A description of the issue and its impact.
- Steps to reproduce, or a minimal proof of concept.
- Affected package(s) and version(s).

## What to expect

- We aim to acknowledge a report within a few business days.
- We will confirm the issue, determine its scope, and keep you updated on a fix.
- Please give us a reasonable window to release a fix before any public
  disclosure.

## Scope

This driver is a **test/development tool**: it attaches to a React Native app's
Hermes runtime over the Chrome DevTools Protocol and can evaluate arbitrary JS in
that runtime. That capability is by design. Ship the harness only in dev/E2E
builds, never in production — see the "Production-safe Setup" section of the
[README](README.md). Reports about the harness being importable in production are
covered by that guidance rather than treated as a vulnerability in the driver
itself.
