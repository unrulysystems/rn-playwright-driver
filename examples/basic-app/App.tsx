import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

// Tall filler blocks between the controls and the below-the-fold target. Eight
// ~200pt blocks push the target well past one viewport height, so
// scrollIntoView must issue more than one swipe to reach it. This is the e2e
// fixture for the scroll API (device.scroll / Locator.scrollIntoView). Stable
// string ids double as React keys and testIDs.
const FILLER_IDS = Array.from({ length: 8 }, (_, i) => `filler-${i}`)

export default function App() {
  const [count, setCount] = useState(0)
  const [dragPhase, setDragPhase] = useState('idle')
  const [dragMoves, setDragMoves] = useState(0)
  const scrollRef = useRef<ScrollView>(null)
  // Controlled TextInput fixture for the Locator.fill() e2e (#11). The mirror
  // Text below echoes React state, so a successful fill (which must fire the
  // synthetic change, not just setNativeProps) is observable on-device.
  const [name, setName] = useState('')

  useEffect(() => {
    const globals = globalThis as typeof globalThis & {
      __RN_DRIVER_EXAMPLE__?: { scrollToTop: () => void }
    }
    globals.__RN_DRIVER_EXAMPLE__ = {
      scrollToTop: () => scrollRef.current?.scrollTo({ y: 0, animated: false }),
    }
    return () => {
      delete globals.__RN_DRIVER_EXAMPLE__
    }
  }, [])

  return (
    <ScrollView
      ref={scrollRef}
      testID="scroll-view"
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title} testID="title">
        RN Playwright Driver Example
      </Text>

      <Text style={styles.counter} testID="count-display">
        Count: {count}
      </Text>

      {/* fill() fixtures: a controlled input (state-mirrored) + an uncontrolled
          one (native value only). The driver resolves these by testID. */}
      <TextInput
        testID="name-input"
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Name (controlled)"
      />
      <Text style={styles.inputMirror} testID="name-value">
        {name}
      </Text>
      <TextInput
        testID="bio-input"
        style={styles.input}
        defaultValue=""
        placeholder="Bio (uncontrolled)"
      />

      <View style={styles.buttonRow}>
        <Pressable
          style={styles.button}
          onPress={() => setCount((c) => c - 1)}
          testID="decrement-button"
          accessibilityRole="button"
          accessibilityLabel="Decrement"
        >
          <Text style={styles.buttonText}>-</Text>
        </Pressable>

        <Pressable
          style={styles.button}
          onPress={() => setCount((c) => c + 1)}
          testID="increment-button"
          accessibilityRole="button"
          accessibilityLabel="Increment"
        >
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.button, styles.resetButton]}
        onPress={() => setCount(0)}
        testID="reset-button"
        accessibilityRole="button"
        accessibilityLabel="Reset"
      >
        <Text style={styles.buttonText}>Reset</Text>
      </Pressable>

      <View
        style={styles.dragTarget}
        testID="drag-target"
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={() => {
          setDragPhase('started')
          setDragMoves(0)
        }}
        onResponderMove={() => setDragMoves((moves) => moves + 1)}
        onResponderRelease={() => setDragPhase('ended')}
      >
        <Text style={styles.dragTargetText}>Drag target</Text>
        <Text style={styles.dragStatus} testID="drag-status">
          Drag: {dragPhase} moves: {dragMoves}
        </Text>
      </View>

      {/* Filler pushes the target below the fold so scrolling is required. */}
      {FILLER_IDS.map((id) => (
        <View key={id} style={styles.filler} testID={id}>
          <Text style={styles.fillerText}>Scroll down…</Text>
        </View>
      ))}

      <View style={styles.target} testID="below-fold-target">
        <Text style={styles.targetText}>You found me!</Text>
      </View>

      <Text style={styles.bottomMarker} testID="bottom-marker">
        End of content
      </Text>

      <StatusBar style="auto" />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    // No flex:1 here — the content must be allowed to exceed the viewport so
    // the ScrollView actually scrolls.
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 40,
  },
  counter: {
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 40,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 8,
  },
  inputMirror: {
    fontSize: 16,
    color: '#333',
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    minWidth: 60,
    alignItems: 'center',
  },
  resetButton: {
    backgroundColor: '#666',
  },
  buttonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  dragTarget: {
    width: '100%',
    minHeight: 96,
    marginTop: 12,
    marginBottom: 20,
    borderRadius: 10,
    backgroundColor: '#1D9A8A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragTargetText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  dragStatus: {
    color: '#fff',
    fontSize: 16,
  },
  filler: {
    width: '100%',
    height: 200,
    marginTop: 20,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fillerText: {
    color: '#999',
    fontSize: 16,
  },
  target: {
    width: '100%',
    marginTop: 20,
    paddingVertical: 40,
    borderRadius: 10,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  bottomMarker: {
    marginTop: 40,
    fontSize: 16,
    color: '#666',
  },
})
