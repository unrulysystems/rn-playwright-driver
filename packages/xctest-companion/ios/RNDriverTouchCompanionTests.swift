import Foundation
import XCTest

final class RNDriverTouchCompanionTests: XCTestCase {
  func testRunServer() throws {
    continueAfterFailure = true
    executionTimeAllowance = 3600

    let environment = ProcessInfo.processInfo.environment
    let envAuthToken = environment["RN_TOUCH_XCTEST_TOKEN"].flatMap { $0.isEmpty ? nil : $0 }
    let runtimeConfig = envAuthToken == nil ? try loadRuntimeConfig(environment: environment) : RuntimeConfig()
    let port = runtimeConfig.port ?? UInt16(environment["RN_TOUCH_XCTEST_PORT"] ?? "") ?? 9999
    let authToken = try XCTUnwrap(
      envAuthToken ?? runtimeConfig.authToken,
      "RN_TOUCH_XCTEST_TOKEN is required so the touch companion cannot accept unauthenticated input."
    )

    let app = XCUIApplication()
    app.launch()

    let server = RNDriverTouchCompanionServer(port: port, authToken: authToken)
    try server.start()

    // Keep the XCTest process alive while Playwright connects over the forwarded
    // WebSocket. The host-side e2e script owns process cleanup.
    withExtendedLifetime(server) {
      RunLoop.current.run()
    }
  }
}

private struct RuntimeConfig {
  var port: UInt16?
  var authToken: String?
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
  return RuntimeConfig(port: port, authToken: authToken)
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
