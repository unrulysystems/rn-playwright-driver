package com.rndriver.touchcompanion

import android.app.Instrumentation
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread

private const val DEFAULT_PORT = 9999
private const val TAG = "RNDriverTouchCompanion"
private const val ARG_AUTH_TOKEN = "rnDriverAuthToken"
private const val AUTH_HEADER = "x-rn-driver-auth"
private const val SOCKET_TIMEOUT_MS = 2_000
private const val MAX_HEADER_BYTES = 16 * 1024
private const val MAX_BODY_BYTES = 1024 * 1024

class RNDriverTouchCompanion : Instrumentation() {
  private var server: TouchCompanionServer? = null
  private var authToken: String? = null
  private val keepAlive = CountDownLatch(1)

  override fun onCreate(arguments: Bundle?) {
    super.onCreate(arguments)
    authToken = arguments?.getString(ARG_AUTH_TOKEN)?.takeIf { it.isNotBlank() }
    start()
  }

  override fun onStart() {
    super.onStart()
    val token = checkNotNull(authToken) {
      "RNDriverTouchCompanion requires -e $ARG_AUTH_TOKEN <token>"
    }
    server = TouchCompanionServer(this, authToken = token)
    server?.start()
    keepAlive.await()
  }
}

private class TouchCompanionServer(
  private val instrumentation: Instrumentation,
  private val port: Int = DEFAULT_PORT,
  private val authToken: String,
) {
  private var serverThread: Thread? = null
  private val density: Float = instrumentation.targetContext.resources.displayMetrics.density

  fun start() {
    if (serverThread != null) return
    serverThread = thread(name = "rn-driver-touch-server", isDaemon = true) {
      ServerSocket().use { serverSocket ->
        serverSocket.bind(InetSocketAddress(InetAddress.getLoopbackAddress(), port))
        Log.i(TAG, "Touch companion listening on 127.0.0.1:$port")
        while (!Thread.currentThread().isInterrupted) {
          val socket = serverSocket.accept()
          try {
            handleClient(socket)
          } catch (error: Exception) {
            Log.w(TAG, "Touch companion request failed", error)
          }
        }
      }
    }
  }

  private fun handleClient(socket: Socket) {
    socket.use { client ->
      val input = BufferedInputStream(client.getInputStream())
      val output = BufferedOutputStream(client.getOutputStream())
      client.soTimeout = SOCKET_TIMEOUT_MS

      val request = readHttpRequest(input) ?: return
      val response = handleCommand(request)

      output.write(response.toByteArray(StandardCharsets.UTF_8))
      output.flush()
    }
  }

  private data class HttpRequest(
    val headers: Map<String, String>,
    val body: String,
  )

  private fun readHttpRequest(input: InputStream): HttpRequest? {
    val headerBuffer = ByteArrayOutputStream()
    val delimiter = "\r\n\r\n".toByteArray(StandardCharsets.UTF_8)
    val temp = ByteArray(1024)

    while (true) {
      val read = input.read(temp)
      if (read <= 0) return null
      headerBuffer.write(temp, 0, read)
      if (headerBuffer.size() > MAX_HEADER_BYTES) {
        throw IllegalArgumentException("HTTP headers exceed ${MAX_HEADER_BYTES} bytes")
      }
      val bytes = headerBuffer.toByteArray()
      val index = indexOf(bytes, delimiter)
      if (index >= 0) {
        val headerText = String(bytes, 0, index + delimiter.size, StandardCharsets.UTF_8)
        val headers = parseHeaders(headerText)
        val contentLength = parseContentLength(headers)
        if (contentLength > MAX_BODY_BYTES) {
          throw IllegalArgumentException("HTTP body exceeds ${MAX_BODY_BYTES} bytes")
        }
        val remainingStart = index + delimiter.size
        val remaining = bytes.size - remainingStart

        val body = ByteArrayOutputStream()
        if (remaining > 0) {
          body.write(bytes, remainingStart, remaining)
        }

        while (body.size() < contentLength) {
          val count = input.read(temp)
          if (count <= 0) break
          body.write(temp, 0, count)
        }
        return HttpRequest(headers, String(body.toByteArray(), StandardCharsets.UTF_8))
      }
    }
  }

  private fun handleCommand(request: HttpRequest): String {
    if (request.headers[AUTH_HEADER] != authToken) {
      return errorResponse("Unauthorized instrumentation companion request", "UNAUTHORIZED", 401)
    }

    return try {
      val payload = JSONObject(request.body)
      val type = payload.optString("type", "")

      when (type) {
        "hello" -> okResponse(JSONObject().apply {
          put("platform", "android")
          put("density", density)
        })
        "tap" -> {
          val (x, y) = parsePoint(payload)
          injectTap(x, y)
          okResponse()
        }
        "down" -> {
          val (x, y) = parsePoint(payload)
          injectDown(x, y)
          okResponse()
        }
        "move" -> {
          val (x, y) = parsePoint(payload)
          injectMove(x, y)
          okResponse()
        }
        "up" -> {
          injectUp()
          okResponse()
        }
        "swipe" -> {
          val from = payload.getJSONObject("from")
          val to = payload.getJSONObject("to")
          val durationMs = payload.optLong("durationMs", 300)
          injectSwipe(
            from.getDouble("x"),
            from.getDouble("y"),
            to.getDouble("x"),
            to.getDouble("y"),
            durationMs,
          )
          okResponse()
        }
        "longPress" -> {
          val (x, y) = parsePoint(payload)
          val durationMs = payload.optLong("durationMs", 500)
          injectLongPress(x, y, durationMs)
          okResponse()
        }
        "typeText" -> {
          val text = payload.optString("text", "")
          instrumentation.sendStringSync(text)
          okResponse()
        }
        else -> errorResponse("Unsupported command: $type", "UNSUPPORTED_COMMAND")
      }
    } catch (error: Exception) {
      errorResponse(error.message ?: "Command failed")
    }
  }

  private fun parsePoint(payload: JSONObject): Pair<Double, Double> {
    val x = payload.getDouble("x")
    val y = payload.getDouble("y")
    return Pair(x, y)
  }

  private fun injectTap(x: Double, y: Double) {
    val downTime = SystemClock.uptimeMillis()
    val xPx = (x * density).toFloat()
    val yPx = (y * density).toFloat()
    injectEvent(MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, xPx, yPx, 0))
    injectEvent(MotionEvent.obtain(downTime, downTime + 50, MotionEvent.ACTION_UP, xPx, yPx, 0))
  }

  private var activeDownTime: Long? = null
  private var lastX: Float = 0f
  private var lastY: Float = 0f

  private fun injectDown(x: Double, y: Double) {
    val downTime = SystemClock.uptimeMillis()
    val xPx = (x * density).toFloat()
    val yPx = (y * density).toFloat()
    activeDownTime = downTime
    lastX = xPx
    lastY = yPx
    injectEvent(MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, xPx, yPx, 0))
  }

  private fun injectMove(x: Double, y: Double) {
    val downTime = activeDownTime ?: return
    val eventTime = SystemClock.uptimeMillis()
    val xPx = (x * density).toFloat()
    val yPx = (y * density).toFloat()
    lastX = xPx
    lastY = yPx
    injectEvent(MotionEvent.obtain(downTime, eventTime, MotionEvent.ACTION_MOVE, xPx, yPx, 0))
  }

  private fun injectUp() {
    val downTime = activeDownTime ?: return
    val eventTime = SystemClock.uptimeMillis()
    injectEvent(MotionEvent.obtain(downTime, eventTime, MotionEvent.ACTION_UP, lastX, lastY, 0))
    activeDownTime = null
  }

  private fun injectSwipe(
    fromX: Double,
    fromY: Double,
    toX: Double,
    toY: Double,
    durationMs: Long,
  ) {
    val steps = maxOf(10, (durationMs / 16).toInt())
    val downTime = SystemClock.uptimeMillis()
    val startX = (fromX * density).toFloat()
    val startY = (fromY * density).toFloat()
    val endX = (toX * density).toFloat()
    val endY = (toY * density).toFloat()

    injectEvent(MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, startX, startY, 0))

    for (i in 1..steps) {
      val t = i.toFloat() / steps
      val x = startX + (endX - startX) * t
      val y = startY + (endY - startY) * t
      val eventTime = downTime + (durationMs * t).toLong()
      injectEvent(MotionEvent.obtain(downTime, eventTime, MotionEvent.ACTION_MOVE, x, y, 0))
    }

    val endTime = downTime + durationMs
    injectEvent(MotionEvent.obtain(downTime, endTime, MotionEvent.ACTION_UP, endX, endY, 0))
  }

  private fun injectLongPress(x: Double, y: Double, durationMs: Long) {
    val downTime = SystemClock.uptimeMillis()
    val xPx = (x * density).toFloat()
    val yPx = (y * density).toFloat()
    injectEvent(MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, xPx, yPx, 0))
    SystemClock.sleep(durationMs)
    val upTime = SystemClock.uptimeMillis()
    injectEvent(MotionEvent.obtain(downTime, upTime, MotionEvent.ACTION_UP, xPx, yPx, 0))
  }

  private fun injectEvent(event: MotionEvent) {
    val uiAutomation = instrumentation.uiAutomation
    uiAutomation.injectInputEvent(event, true)
    event.recycle()
  }

  private fun okResponse(result: JSONObject? = null): String {
    val payload = JSONObject()
    payload.put("ok", true)
    if (result != null) {
      payload.put("result", result)
    }
    return httpResponse(payload.toString())
  }

  private fun errorResponse(message: String, code: String = "INTERNAL", status: Int = 500): String {
    val payload = JSONObject()
    payload.put("ok", false)
    payload.put("error", JSONObject().apply {
      put("message", message)
      put("code", code)
    })
    return httpResponse(payload.toString(), status)
  }

  private fun httpResponse(body: String, status: Int = 200): String {
    return "HTTP/1.1 $status OK\r\n" +
      "Content-Type: application/json\r\n" +
      "Content-Length: ${body.toByteArray(StandardCharsets.UTF_8).size}\r\n" +
      "Connection: close\r\n\r\n" +
      body
  }

  private fun parseHeaders(headerText: String): Map<String, String> {
    return headerText.split("\r\n")
      .drop(1)
      .mapNotNull { line ->
        val separator = line.indexOf(':')
        if (separator <= 0) return@mapNotNull null
        val name = line.substring(0, separator).trim().lowercase()
        val value = line.substring(separator + 1).trim()
        name to value
      }
      .toMap()
  }

  private fun parseContentLength(headers: Map<String, String>): Int {
    return headers["content-length"]?.toIntOrNull() ?: 0
  }

  private fun indexOf(haystack: ByteArray, needle: ByteArray): Int {
    outer@ for (i in 0..haystack.size - needle.size) {
      for (j in needle.indices) {
        if (haystack[i + j] != needle[j]) continue@outer
      }
      return i
    }
    return -1
  }
}
