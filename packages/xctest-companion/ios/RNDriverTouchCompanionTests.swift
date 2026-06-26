import Foundation
import XCTest

final class RNDriverTouchCompanionTests: XCTestCase {
  func testRunServer() throws {
    continueAfterFailure = true
    executionTimeAllowance = 3600

    let environment = ProcessInfo.processInfo.environment
    let envAuthToken = environment["RN_TOUCH_XCTEST_TOKEN"].flatMap { $0.isEmpty ? nil : $0 }
    let runtimeConfig = try loadRuntimeConfig(environment: environment)
    let port = runtimeConfig.port ?? UInt16(environment["RN_TOUCH_XCTEST_PORT"] ?? "") ?? 9999
    let authToken = try XCTUnwrap(
      envAuthToken ?? runtimeConfig.authToken,
      "RN_TOUCH_XCTEST_TOKEN is required so the touch companion cannot accept unauthenticated input."
    )
    let launchMode = try resolveLaunchMode(environment: environment, runtimeConfig: runtimeConfig)

    prepareApp(launchMode: launchMode)

    let server = RNDriverTouchCompanionServer(port: port, authToken: authToken)
    try server.start()

    // Keep the XCTest process alive while Playwright connects over the forwarded
    // WebSocket. The host-side e2e script owns process cleanup.
    withExtendedLifetime(server) {
      RunLoop.current.run()
    }
  }
}

private enum LaunchMode: String {
  case launch
  case activate
  case attach
}

private struct RuntimeConfig {
  var port: UInt16?
  var authToken: String?
  var launchMode: LaunchMode?
}

private func prepareApp(launchMode: LaunchMode) {
  let app = XCUIApplication()
  switch launchMode {
  case .launch:
    app.launch()
  case .activate:
    app.activate()
  case .attach:
    // Host-launched apps, such as Expo dev-client apps opened by deep link,
    // should not be relaunched by XCTest. Touch commands activate the target
    // app when they need coordinates or keyboard input.
    return
  }
}

private func resolveLaunchMode(
  environment: [String: String],
  runtimeConfig: RuntimeConfig
) throws -> LaunchMode {
  if let launchMode = try parseLaunchMode(environment["RN_TOUCH_XCTEST_LAUNCH"]) {
    return launchMode
  }
  if let launchMode = try parseLaunchMode(environment["RN_TOUCH_XCTEST_LAUNCH_MODE"]) {
    return launchMode
  }
  return runtimeConfig.launchMode ?? .launch
}

private func loadRuntimeConfig(environment: [String: String]) throws -> RuntimeConfig {
  guard let configFile = resolveRuntimeConfigFile(environment: environment) else {
    return RuntimeConfig()
  }
  guard FileManager.default.fileExists(atPath: configFile) else {
    return RuntimeConfig()
  }

  let data = try Data(contentsOf: URL(fileURLWithPath: configFile))
  guard
    let payload = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
  else {
    return RuntimeConfig()
  }

  let port = parsePort(payload["port"])
  let authToken = try parseAuthToken(payload)
  let launchMode = try parseLaunchMode(payload["launchMode"] ?? payload["launch"])
  return RuntimeConfig(port: port, authToken: authToken, launchMode: launchMode)
}

private func resolveRuntimeConfigFile(environment: [String: String]) -> String? {
  if let configFile = environment["RN_TOUCH_XCTEST_CONFIG_FILE"], !configFile.isEmpty {
    return configFile
  }
  return Bundle(for: RNDriverTouchCompanionTests.self)
    .url(forResource: "RNDriverTouchCompanionRuntimeConfig", withExtension: "json")?
    .path
}

private func parsePort(_ value: Any?) -> UInt16? {
  if let number = value as? NSNumber {
    let intValue = number.intValue
    return intValue > 0 && intValue <= UInt16.max ? UInt16(intValue) : nil
  }
  if let string = value as? String {
    return UInt16(string)
  }
  return nil
}

private func parseAuthToken(_ payload: [String: Any]) throws -> String? {
  if let token = payload["authToken"] as? String, !token.isEmpty {
    return token
  }

  guard let tokenFile = payload["authTokenFile"] as? String, !tokenFile.isEmpty else {
    return nil
  }

  let token = try String(contentsOfFile: tokenFile, encoding: .utf8)
    .trimmingCharacters(in: .whitespacesAndNewlines)
  return token.isEmpty ? nil : token
}

private func parseLaunchMode(_ value: Any?) throws -> LaunchMode? {
  guard let value else {
    return nil
  }

  guard let string = value as? String, !string.isEmpty else {
    throw NSError(domain: "RNDriverTouchCompanion", code: 3, userInfo: [
      NSLocalizedDescriptionKey: "launch must be one of: launch, activate, attach"
    ])
  }

  guard let launchMode = LaunchMode(rawValue: string) else {
    throw NSError(domain: "RNDriverTouchCompanion", code: 4, userInfo: [
      NSLocalizedDescriptionKey: "Unsupported launch mode '\(string)'. Expected one of: launch, activate, attach"
    ])
  }

  return launchMode
}
