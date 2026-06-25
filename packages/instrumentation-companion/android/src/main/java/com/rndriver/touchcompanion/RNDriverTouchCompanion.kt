package com.rndriver.touchcompanion

import android.app.Instrumentation
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread

private const val DEFAULT_PORT = 9999
private const val TAG = "RNDriverTouchCompanion"

class RNDriverTouchCompanion : Instrumentation() {
  private var server: TouchCompanionServer? = null
  private val keepAlive = CountDownLatch(1)

  override fun onStart() {
    super.onStart()
    server = TouchCompanionServer(this)
    server?.start()
    keepAlive.await()
  }
}

private class TouchCompanionServer(
  private val instrumentation: Instrumentation,
  private val port: Int = DEFAULT_PORT,
) {
  private var serverThread: Thread? = null
  private val density: Float = instrumentation.targetContext.resources.displayMetrics.density

  fun start() {
    if (serverThread != null) return
    serverThread = thread(name = "rn-driver-touch-server", isDaemon = true) {
      ServerSocket(port).use { serverSocket ->
        Log.i(TAG, "Touch companion listening on :$port")
        while (!Thread.currentThread().isInterrupted) {
          val socket = serverSocket.accept()
          handleClient(socket)
        }
      }
    }
  }

  private fun handleClient(socket: Socket) {
    socket.use { client ->
      val input = BufferedInputStream(client.getInputStream())
      val output = BufferedOutputStream(client.getOutputStream())

      val request = readHttpRequest(input) ?: return
      val response = handleCommand(request)

      output.write(response.toByteArray(StandardCharsets.UTF_8))
      output.flush()
    }
  }

  private fun readHttpRequest(input: InputStream): String? {
    val headerBuffer = ByteArrayOutputStream()
    val delimiter = "\r\n\r\n".toByteArray(StandardCharsets.UTF_8)
    val temp = ByteArray(1024)

    while (true) {
      val read = input.read(temp)
      if (read <= 0) return null
      headerBuffer.write(temp, 0, read)
      val bytes = headerBuffer.toByteArray()
      val index = indexOf(bytes, delimiter)
      if (index >= 0) {
        val headers = String(bytes, 0, index + delimiter.size, StandardCharsets.UTF_8)
        val contentLength = parseContentLength(headers)
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
        return String(body.toByteArray(), StandardCharsets.UTF_8)
      }
    }
  }

  private fun handleCommand(body: String): String {
    return try {
      val payload = JSONObject(body)
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

  private fun errorResponse(message: String, code: String = "INTERNAL"): String {
    val payload = JSONObject()
    payload.put("ok", false)
    payload.put("error", JSONObject().apply {
      put("message", message)
      put("code", code)
    })
    return httpResponse(payload.toString(), 500)
  }

  private fun httpResponse(body: String, status: Int = 200): String {
    return "HTTP/1.1 $status OK\r\n" +
      "Content-Type: application/json\r\n" +
      "Content-Length: ${body.toByteArray(StandardCharsets.UTF_8).size}\r\n" +
      "Connection: close\r\n\r\n" +
      body
  }

  private fun parseContentLength(headers: String): Int {
    return headers.split("\r\n")
      .firstOrNull { it.lowercase().startsWith("content-length") }
      ?.split(":")
      ?.getOrNull(1)
      ?.trim()
      ?.toIntOrNull() ?: 0
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
