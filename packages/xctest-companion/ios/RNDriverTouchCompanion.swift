import CryptoKit
import Darwin
import Foundation
import UIKit
import XCTest

private let defaultPort: UInt16 = 9999
private let debugLoggingEnabled = ProcessInfo.processInfo.environment["RN_TOUCH_XCTEST_DEBUG"] == "1"

private func debugLog(_ message: String) {
  if debugLoggingEnabled {
    NSLog("RNDriverTouchCompanion: \(message)")
  }
}

final class RNDriverTouchCompanionServer {
  private let port: UInt16
  private let authToken: String
  private var listenerSocket: Int32 = -1
  private var sessions: [WebSocketSession] = []
  private let queue = DispatchQueue(label: "rn-driver.touch-companion")

  private var pendingPath: [CGPoint] = []
  private var pendingDownTime: Date?

  init(port: UInt16 = defaultPort, authToken: String) {
    self.port = port
    self.authToken = authToken
  }

  func start() throws {
    let socketFd = socket(AF_INET, SOCK_STREAM, 0)
    guard socketFd >= 0 else {
      throw socketError("socket")
    }

    var reuse: Int32 = 1
    setsockopt(socketFd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

    let bindResult = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
        bind(socketFd, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }

    guard bindResult == 0 else {
      close(socketFd)
      throw socketError("bind")
    }

    guard listen(socketFd, SOMAXCONN) == 0 else {
      close(socketFd)
      throw socketError("listen")
    }

    listenerSocket = socketFd
    debugLog("listening on 127.0.0.1:\(port)")

    queue.async { [weak self] in
      self?.acceptLoop(socketFd)
    }
  }

  private func acceptLoop(_ socketFd: Int32) {
    while true {
      let clientFd = accept(socketFd, nil, nil)
      if clientFd < 0 {
        if errno == EINTR {
          continue
        }
        return
      }

      handle(clientFd)
    }
  }

  private func handle(_ clientFd: Int32) {
    debugLog("accepted connection")
    var noSigPipe: Int32 = 1
    setsockopt(clientFd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))

    let session = WebSocketSession(socketFd: clientFd)
    sessions.append(session)
    session.onText = { [weak self, weak session] text in
      guard let session else { return }
      self?.handleMessage(text, session: session)
    }
    session.start()
  }

  private func socketError(_ operation: String) -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: [
      NSLocalizedDescriptionKey: "\(operation) failed: \(String(cString: strerror(errno)))"
    ])
  }

  private func handleMessage(_ text: String, session: WebSocketSession) {
    guard let data = text.data(using: .utf8) else {
      return
    }

    guard
      let payload = try? JSONSerialization.jsonObject(with: data, options: []),
      let dict = payload as? [String: Any],
      let id = dict["id"] as? Int,
      let type = dict["type"] as? String
    else {
      session.sendError(id: nil, message: "Invalid message")
      return
    }

    if dict["authToken"] as? String != authToken {
      session.sendError(id: id, message: "Unauthorized")
      return
    }

    do {
      switch type {
      case "hello":
        let screen = UIScreen.main.bounds
        let result: [String: Any] = [
          "platform": "ios",
          "scale": UIScreen.main.scale,
          "screen": ["width": screen.width, "height": screen.height]
        ]
        session.sendOk(id: id, result: result)
      case "tap":
        let point = try parsePoint(dict)
        performOnMain {
          self.tap(point)
        }
        session.sendOk(id: id)
      case "down":
        let point = try parsePoint(dict)
        pendingPath = [point]
        pendingDownTime = Date()
        session.sendOk(id: id)
      case "move":
        let point = try parsePoint(dict)
        if pendingPath.isEmpty {
          pendingPath = [point]
        } else {
          pendingPath.append(point)
        }
        session.sendOk(id: id)
      case "up":
        performOnMain {
          self.flushPendingPath()
        }
        session.sendOk(id: id)
      case "swipe":
        let from = try parsePoint(dict, key: "from")
        let to = try parsePoint(dict, key: "to")
        let durationMs = try parseDouble(dict, key: "durationMs")
        performOnMain {
          self.drag(from: from, to: to, holdSeconds: 0, durationSeconds: durationMs / 1000.0)
        }
        session.sendOk(id: id)
      case "longPress":
        let point = try parsePoint(dict)
        let durationMs = try parseDouble(dict, key: "durationMs")
        performOnMain {
          self.longPress(point, durationSeconds: durationMs / 1000.0)
        }
        session.sendOk(id: id)
      case "typeText":
        let text = try parseString(dict, key: "text")
        performOnMain {
          self.typeText(text)
        }
        session.sendOk(id: id)
      default:
        session.sendError(id: id, message: "Unsupported command: \(type)")
      }
    } catch {
      session.sendError(id: id, message: error.localizedDescription)
    }
  }

  private func performOnMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread {
      work()
    } else {
      DispatchQueue.main.sync(execute: work)
    }
  }

  private func coordinate(for point: CGPoint) -> XCUICoordinate {
    let app = XCUIApplication()
    app.activate()
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    return origin.withOffset(CGVector(dx: point.x, dy: point.y))
  }

  private func tap(_ point: CGPoint) {
    coordinate(for: point).tap()
  }

  private func longPress(_ point: CGPoint, durationSeconds: Double) {
    coordinate(for: point).press(forDuration: durationSeconds)
  }

  private func drag(
    from: CGPoint,
    to: CGPoint,
    holdSeconds: Double,
    durationSeconds: Double? = nil
  ) {
    let start = coordinate(for: from)
    let end = coordinate(for: to)
    guard let durationSeconds, durationSeconds > 0 else {
      start.press(forDuration: holdSeconds, thenDragTo: end)
      return
    }

    let distance = hypot(to.x - from.x, to.y - from.y)
    let velocity = XCUIGestureVelocity(max(1.0, distance / CGFloat(durationSeconds)))
    start.press(
      forDuration: holdSeconds,
      thenDragTo: end,
      withVelocity: velocity,
      thenHoldForDuration: 0,
    )
  }

  private func flushPendingPath() {
    guard let start = pendingPath.first else { return }
    let end = pendingPath.last ?? start
    let holdSeconds: Double
    if let downTime = pendingDownTime {
      holdSeconds = max(0.0, Date().timeIntervalSince(downTime))
    } else {
      holdSeconds = 0.0
    }
    drag(from: start, to: end, holdSeconds: holdSeconds)
    pendingPath = []
    pendingDownTime = nil
  }

  private func typeText(_ text: String) {
    let app = XCUIApplication()
    app.activate()
    app.typeText(text)
  }

  private func parsePoint(_ dict: [String: Any], key: String = "") throws -> CGPoint {
    if key.isEmpty {
      let x = try parseDouble(dict, key: "x")
      let y = try parseDouble(dict, key: "y")
      return CGPoint(x: x, y: y)
    }

    guard let nested = dict[key] as? [String: Any] else {
      throw NSError(domain: "RNDriverTouchCompanion", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Missing point: \(key)"
      ])
    }
    let x = try parseDouble(nested, key: "x")
    let y = try parseDouble(nested, key: "y")
    return CGPoint(x: x, y: y)
  }

  private func parseDouble(_ dict: [String: Any], key: String) throws -> Double {
    if let value = dict[key] as? Double {
      return value
    }
    if let value = dict[key] as? Int {
      return Double(value)
    }
    throw NSError(domain: "RNDriverTouchCompanion", code: 2, userInfo: [
      NSLocalizedDescriptionKey: "Missing numeric field: \(key)"
    ])
  }

  private func parseString(_ dict: [String: Any], key: String) throws -> String {
    guard let value = dict[key] as? String else {
      throw NSError(domain: "RNDriverTouchCompanion", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "Missing string field: \(key)"
      ])
    }
    return value
  }
}

private final class WebSocketSession {
  private let socketFd: Int32
  private var buffer = Data()
  private var isWebSocket = false
  private var isClosed = false

  var onText: ((String) -> Void)?

  init(socketFd: Int32) {
    self.socketFd = socketFd
  }

  deinit {
    closeSession()
  }

  func start() {
    Thread.detachNewThread { [self] in
      debugLog("session reader started fd=\(socketFd)")
      receiveLoop()
    }
  }

  func sendOk(id: Int, result: [String: Any]? = nil) {
    var payload: [String: Any] = ["id": id, "ok": true]
    if let result {
      payload["result"] = result
    }
    send(payload)
  }

  func sendError(id: Int?, message: String) {
    var payload: [String: Any] = ["ok": false, "error": ["message": message]]
    if let id {
      payload["id"] = id
    }
    send(payload)
  }

  private func send(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
      return
    }
    sendText(String(data: data, encoding: .utf8) ?? "{}")
  }

  private func sendText(_ text: String) {
    let payload = Data(text.utf8)
    var frame = Data()
    frame.append(0x81)

    if payload.count < 126 {
      frame.append(UInt8(payload.count))
    } else if payload.count <= 0xFFFF {
      frame.append(126)
      frame.append(UInt8((payload.count >> 8) & 0xFF))
      frame.append(UInt8(payload.count & 0xFF))
    } else {
      frame.append(127)
      let length = UInt64(payload.count)
      for shift in stride(from: 56, through: 0, by: -8) {
        frame.append(UInt8((length >> UInt64(shift)) & 0xFF))
      }
    }

    frame.append(payload)
    sendAll(frame)
  }

  private func receiveLoop() {
    var bytes = [UInt8](repeating: 0, count: 65_536)

    while !isClosed {
      debugLog("waiting for bytes fd=\(socketFd)")
      let count = bytes.withUnsafeMutableBytes { rawBuffer in
        recv(socketFd, rawBuffer.baseAddress, rawBuffer.count, 0)
      }
      if count <= 0 {
        debugLog("recv closed fd=\(socketFd) count=\(count) errno=\(errno)")
        closeSession()
        return
      }

      debugLog("received \(count) bytes")
      buffer.append(contentsOf: bytes.prefix(count))

      if !isWebSocket {
        handleHandshakeIfPossible()
      }

      if isWebSocket {
        handleFrames()
      }
    }
  }

  private func handleHandshakeIfPossible() {
    guard let range = buffer.range(of: Data("\r\n\r\n".utf8)) else {
      return
    }
    debugLog("handling websocket handshake")

    let requestData = buffer.subdata(in: 0..<range.upperBound)
    buffer.removeSubrange(0..<range.upperBound)

    guard let request = String(data: requestData, encoding: .utf8) else {
      debugLog("websocket handshake request was not utf8")
      return
    }

    var lines = request.components(separatedBy: "\r\n")
    if lines.count <= 1 {
      lines = request.components(separatedBy: "\n")
    }

    guard let keyLine = lines.first(where: { line in
      line.lowercased().hasPrefix("sec-websocket-key")
    }) else {
      debugLog("websocket handshake missing key")
      return
    }

    let parts = keyLine.split(separator: ":", maxSplits: 1)
    guard parts.count >= 2 else {
      debugLog("websocket handshake malformed key line")
      return
    }
    let key = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
    let accept = websocketAccept(for: key)

    let response = "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: \(accept)\r\n\r\n"

    debugLog("sending websocket handshake bytes=\(response.utf8.count)")
    sendAll(response.data(using: .utf8) ?? Data())
    isWebSocket = true
  }

  private func handleFrames() {
    while true {
      guard buffer.count >= 2 else { return }
      let firstByte = buffer[0]
      let secondByte = buffer[1]
      let opcode = firstByte & 0x0F
      let masked = (secondByte & 0x80) != 0
      var payloadLength = Int(secondByte & 0x7F)
      var offset = 2

      if payloadLength == 126 {
        guard buffer.count >= 4 else { return }
        payloadLength = Int(buffer[2]) << 8 | Int(buffer[3])
        offset = 4
      } else if payloadLength == 127 {
        guard buffer.count >= 10 else { return }
        var length: UInt64 = 0
        for i in 2..<10 {
          length = (length << 8) | UInt64(buffer[i])
        }
        payloadLength = Int(length)
        offset = 10
      }

      let maskKeyLength = masked ? 4 : 0
      let frameLength = offset + maskKeyLength + payloadLength
      guard buffer.count >= frameLength else { return }

      var payload = buffer.subdata(in: (offset + maskKeyLength)..<frameLength)
      if masked {
        let maskStart = buffer.subdata(in: offset..<(offset + 4))
        let maskBytes = [UInt8](maskStart)
        var bytes = [UInt8](payload)
        for i in 0..<bytes.count {
          bytes[i] ^= maskBytes[i % 4]
        }
        payload = Data(bytes)
      }

      buffer.removeSubrange(0..<frameLength)

    switch opcode {
      case 0x1:
        if let text = String(data: payload, encoding: .utf8) {
          onText?(text)
        }
      case 0x8:
        closeSession()
        return
      case 0x9:
        sendPong(payload)
      default:
        continue
      }
    }
  }

  private func sendPong(_ payload: Data) {
    var frame = Data()
    frame.append(0x8A)
    if payload.count < 126 {
      frame.append(UInt8(payload.count))
    } else {
      frame.append(126)
      frame.append(UInt8((payload.count >> 8) & 0xFF))
      frame.append(UInt8(payload.count & 0xFF))
    }
    frame.append(payload)
    sendAll(frame)
  }

  private func websocketAccept(for key: String) -> String {
    let magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    let combined = key + magic
    let hash = Insecure.SHA1.hash(data: Data(combined.utf8))
    return Data(hash).base64EncodedString()
  }

  private func sendAll(_ data: Data) {
    data.withUnsafeBytes { rawBuffer in
      guard let baseAddress = rawBuffer.baseAddress else { return }

      var sent = 0
      while sent < data.count {
        let result = Darwin.send(socketFd, baseAddress.advanced(by: sent), data.count - sent, 0)
        if result <= 0 {
          debugLog("send failed fd=\(socketFd) result=\(result) errno=\(errno)")
          closeSession()
          return
        }
        debugLog("sent bytes fd=\(socketFd) count=\(result)")
        sent += result
      }
    }
  }

  private func closeSession() {
    guard !isClosed else { return }
    isClosed = true
    close(socketFd)
  }
}
