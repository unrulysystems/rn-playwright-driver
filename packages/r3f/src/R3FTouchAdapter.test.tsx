/**
 * Unit tests for R3FTouchAdapter
 *
 * These tests verify that touch events dispatched to R3F objects
 * include the necessary screen coordinates for drag handling.
 */

import type {
	RNDriverGlobal,
	TouchEvent,
	TouchHandler,
} from "@0xbigboss/rn-playwright-driver/harness";
import type { Camera, Object3D, Raycaster, Scene } from "three";
import { Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Track cleanup functions from useEffect
let effectCleanup: (() => void) | undefined;

// Mock React
vi.mock("react", () => ({
	useEffect: vi.fn((effect: () => (() => void) | undefined) => {
		const cleanup = effect();
		if (typeof cleanup === "function") {
			effectCleanup = cleanup;
		}
	}),
}));

// Mock useThree hook
vi.mock("@react-three/fiber", () => ({
	useThree: vi.fn(),
}));

// Import after mocking
import { useThree } from "@react-three/fiber";
import { R3FTouchAdapter } from "./R3FTouchAdapter";

describe("R3FTouchAdapter", () => {
	let capturedHandler: TouchHandler | null = null;
	let dispatchedEvents: Array<Record<string, unknown>> = [];
	let mockObject: Partial<Object3D>;
	let mockRaycaster: Partial<Raycaster>;
	let mockScene: Partial<Scene>;
	let mockCamera: Partial<Camera>;
	let mockDriver: Partial<RNDriverGlobal>;

	beforeEach(() => {
		capturedHandler = null;
		dispatchedEvents = [];
		effectCleanup = undefined;

		// Create mock object that captures dispatched events
		mockObject = {
			dispatchEvent: vi.fn((event) => {
				dispatchedEvents.push(event as Record<string, unknown>);
			}),
		};

		// Create mock raycaster that returns our mock object as a hit
		mockRaycaster = {
			setFromCamera: vi.fn(),
			intersectObjects: vi.fn().mockReturnValue([
				{
					point: new Vector3(1, 2, 3),
					distance: 10,
					object: mockObject,
				},
			]),
		};

		// Create mock scene
		mockScene = {
			updateMatrixWorld: vi.fn(),
			children: [],
		};

		// Create mock camera
		mockCamera = {
			updateMatrixWorld: vi.fn(),
		};

		// Mock useThree to return our mocks
		vi.mocked(useThree).mockReturnValue({
			camera: mockCamera as Camera,
			raycaster: mockRaycaster as Raycaster,
			scene: mockScene as Scene,
			size: { width: 400, height: 800, left: 0, top: 0 },
		} as ReturnType<typeof useThree>);

		// Create mock driver that captures the registered handler
		mockDriver = {
			registerTouchHandler: vi.fn((_key: string, handler: TouchHandler) => {
				capturedHandler = handler;
			}),
			unregisterTouchHandler: vi.fn(),
		};

		// Install mock driver
		globalThis.__RN_DRIVER__ = mockDriver as RNDriverGlobal;
	});

	afterEach(() => {
		// Run cleanup
		effectCleanup?.();
		// Clean up global
		delete (globalThis as { __RN_DRIVER__?: unknown }).__RN_DRIVER__;
	});

	it("includes clientX/clientY in dispatched pointer events", () => {
		// Render the component (this registers the handler via mocked useEffect)
		R3FTouchAdapter({});

		// Verify handler was registered
		expect(mockDriver.registerTouchHandler).toHaveBeenCalledWith("r3f", expect.any(Function));
		expect(capturedHandler).not.toBeNull();

		// Simulate a touch event
		const touchEvent: TouchEvent = {
			x: 200,
			y: 400,
			type: "down",
			timestamp: Date.now(),
		};
		capturedHandler!(touchEvent);

		// Verify event was dispatched with screen coordinates
		expect(dispatchedEvents).toHaveLength(1);
		const dispatched = dispatchedEvents[0];

		expect(dispatched.type).toBe("pointerdown");
		expect(dispatched.clientX).toBe(200);
		expect(dispatched.clientY).toBe(400);
	});

	it("includes pageX/pageY in dispatched pointer events", () => {
		R3FTouchAdapter({});

		const touchEvent: TouchEvent = {
			x: 150,
			y: 300,
			type: "move",
			timestamp: Date.now(),
		};
		capturedHandler!(touchEvent);

		expect(dispatchedEvents).toHaveLength(1);
		const dispatched = dispatchedEvents[0];

		expect(dispatched.type).toBe("pointermove");
		expect(dispatched.pageX).toBe(150);
		expect(dispatched.pageY).toBe(300);
	});

	it("preserves world coordinates alongside screen coordinates", () => {
		R3FTouchAdapter({});

		const touchEvent: TouchEvent = {
			x: 100,
			y: 200,
			type: "up",
			timestamp: Date.now(),
		};
		capturedHandler!(touchEvent);

		expect(dispatchedEvents).toHaveLength(1);
		const dispatched = dispatchedEvents[0];

		// Screen coordinates
		expect(dispatched.clientX).toBe(100);
		expect(dispatched.clientY).toBe(200);

		// World coordinates from raycast hit
		expect(dispatched.point).toEqual(new Vector3(1, 2, 3));
		expect(dispatched.distance).toBe(10);
		expect(dispatched.object).toBe(mockObject);
	});

	it("maps touch event types to pointer event types correctly", () => {
		R3FTouchAdapter({});

		// Test all three event types
		capturedHandler!({ x: 0, y: 0, type: "down", timestamp: Date.now() });
		capturedHandler!({ x: 0, y: 0, type: "move", timestamp: Date.now() });
		capturedHandler!({ x: 0, y: 0, type: "up", timestamp: Date.now() });

		expect(dispatchedEvents).toHaveLength(3);
		expect(dispatchedEvents[0].type).toBe("pointerdown");
		expect(dispatchedEvents[1].type).toBe("pointermove");
		expect(dispatchedEvents[2].type).toBe("pointerup");
	});

	it("does not dispatch events when no objects are hit", () => {
		// Configure raycaster to return no hits
		vi.mocked(mockRaycaster.intersectObjects!).mockReturnValue([]);

		R3FTouchAdapter({});
		capturedHandler!({ x: 100, y: 200, type: "down", timestamp: Date.now() });

		expect(dispatchedEvents).toHaveLength(0);
	});
});
