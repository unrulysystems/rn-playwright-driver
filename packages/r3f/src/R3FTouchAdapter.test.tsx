/**
 * Unit tests for R3FTouchAdapter
 *
 * These tests verify that touch events are routed to R3F's internal
 * event handlers with the correct synthetic PointerEvent properties.
 */

import type {
	RNDriverGlobal,
	TouchEvent,
	TouchHandler,
} from "@0xbigboss/rn-playwright-driver/harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Track cleanup functions from useEffect
let effectCleanup: (() => void) | undefined;

// Track ref value
let refValue = { current: 1 };

// Mock React
vi.mock("react", () => ({
	useEffect: vi.fn((effect: () => (() => void) | undefined) => {
		const cleanup = effect();
		if (typeof cleanup === "function") {
			effectCleanup = cleanup;
		}
	}),
	useRef: vi.fn((initial: number) => {
		refValue = { current: initial };
		return refValue;
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
	let r3fHandlerCalls: Array<{ name: string; event: PointerEvent }> = [];
	let mockDriver: Partial<RNDriverGlobal>;
	let mockEvents: {
		handlers: {
			onPointerDown: (e: PointerEvent) => void;
			onPointerMove: (e: PointerEvent) => void;
			onPointerUp: (e: PointerEvent) => void;
		};
	};

	beforeEach(() => {
		capturedHandler = null;
		r3fHandlerCalls = [];
		effectCleanup = undefined;
		refValue = { current: 1 };

		// Create mock R3F event handlers that capture calls
		mockEvents = {
			handlers: {
				onPointerDown: vi.fn((e: PointerEvent) => {
					r3fHandlerCalls.push({ name: "onPointerDown", event: e });
				}),
				onPointerMove: vi.fn((e: PointerEvent) => {
					r3fHandlerCalls.push({ name: "onPointerMove", event: e });
				}),
				onPointerUp: vi.fn((e: PointerEvent) => {
					r3fHandlerCalls.push({ name: "onPointerUp", event: e });
				}),
			},
		};

		// Mock useThree to return events based on selector
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(useThree).mockImplementation(((selector?: (state: unknown) => unknown) => {
			const state = { events: mockEvents };
			if (selector) {
				return selector(state);
			}
			return state;
		}) as typeof useThree);

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

	it("calls R3F onPointerDown handler with correct event properties", () => {
		R3FTouchAdapter({});

		expect(mockDriver.registerTouchHandler).toHaveBeenCalledWith("r3f", expect.any(Function));
		expect(capturedHandler).not.toBeNull();

		const touchEvent: TouchEvent = {
			x: 200,
			y: 400,
			type: "down",
			timestamp: Date.now(),
		};
		capturedHandler!(touchEvent);

		expect(r3fHandlerCalls).toHaveLength(1);
		expect(r3fHandlerCalls[0].name).toBe("onPointerDown");

		const event = r3fHandlerCalls[0].event;
		expect(event.offsetX).toBe(200);
		expect(event.offsetY).toBe(400);
		expect(event.clientX).toBe(200);
		expect(event.clientY).toBe(400);
		expect(event.pointerId).toBe(1);
		expect(event.pointerType).toBe("touch");
	});

	it("calls R3F onPointerMove handler for move events", () => {
		R3FTouchAdapter({});

		const touchEvent: TouchEvent = {
			x: 150,
			y: 300,
			type: "move",
			timestamp: Date.now(),
		};
		capturedHandler!(touchEvent);

		expect(r3fHandlerCalls).toHaveLength(1);
		expect(r3fHandlerCalls[0].name).toBe("onPointerMove");

		const event = r3fHandlerCalls[0].event;
		expect(event.offsetX).toBe(150);
		expect(event.offsetY).toBe(300);
	});

	it("calls R3F onPointerUp handler for up events", () => {
		R3FTouchAdapter({});

		const touchEvent: TouchEvent = {
			x: 100,
			y: 200,
			type: "up",
			timestamp: Date.now(),
		};
		capturedHandler!(touchEvent);

		expect(r3fHandlerCalls).toHaveLength(1);
		expect(r3fHandlerCalls[0].name).toBe("onPointerUp");

		const event = r3fHandlerCalls[0].event;
		expect(event.offsetX).toBe(100);
		expect(event.offsetY).toBe(200);
	});

	it("includes button state in synthetic events", () => {
		R3FTouchAdapter({});

		// Button down during pointer down
		capturedHandler!({ x: 0, y: 0, type: "down", timestamp: Date.now() });
		expect(r3fHandlerCalls[0].event.buttons).toBe(1);
		expect(r3fHandlerCalls[0].event.button).toBe(0);

		// Button still down during move
		capturedHandler!({ x: 10, y: 10, type: "move", timestamp: Date.now() });
		expect(r3fHandlerCalls[1].event.buttons).toBe(1);

		// Button released on up
		capturedHandler!({ x: 10, y: 10, type: "up", timestamp: Date.now() });
		expect(r3fHandlerCalls[2].event.buttons).toBe(0);
	});

	it("includes target with pointer capture methods for drag operations", () => {
		R3FTouchAdapter({});

		capturedHandler!({ x: 100, y: 100, type: "down", timestamp: Date.now() });

		const event = r3fHandlerCalls[0].event;
		expect(event.target).toBeDefined();
		expect(typeof (event.target as HTMLElement).setPointerCapture).toBe("function");
		expect(typeof (event.target as HTMLElement).releasePointerCapture).toBe("function");

		// Should not throw when called
		expect(() => (event.target as HTMLElement).setPointerCapture(1)).not.toThrow();
		expect(() => (event.target as HTMLElement).releasePointerCapture(1)).not.toThrow();
	});

	it("increments pointer ID after up event for gesture tracking", () => {
		R3FTouchAdapter({});

		// First gesture
		capturedHandler!({ x: 0, y: 0, type: "down", timestamp: Date.now() });
		expect(r3fHandlerCalls[0].event.pointerId).toBe(1);

		capturedHandler!({ x: 10, y: 10, type: "up", timestamp: Date.now() });
		expect(r3fHandlerCalls[1].event.pointerId).toBe(1);

		// Second gesture should have incremented pointer ID
		capturedHandler!({ x: 20, y: 20, type: "down", timestamp: Date.now() });
		expect(r3fHandlerCalls[2].event.pointerId).toBe(2);
	});

	it("does not call handlers when events object has no handlers", () => {
		// Mock events without handlers
		vi.mocked(useThree).mockImplementation(((selector?: (state: unknown) => unknown) => {
			const state = { events: { handlers: undefined } };
			if (selector) {
				return selector(state);
			}
			return state;
		}) as typeof useThree);

		R3FTouchAdapter({});
		capturedHandler!({ x: 100, y: 200, type: "down", timestamp: Date.now() });

		// No handlers should be called
		expect(r3fHandlerCalls).toHaveLength(0);
	});

	it("registers with custom id for multi-canvas support", () => {
		R3FTouchAdapter({ id: "secondary" });

		expect(mockDriver.registerTouchHandler).toHaveBeenCalledWith(
			"r3f:secondary",
			expect.any(Function),
		);
	});
});
