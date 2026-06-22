export type {
  ElementBounds,
  ElementHandle,
  ElementInfo,
  ErrorCode,
  NativeResult,
} from '@0xbigboss/rn-driver-shared-types'

/**
 * Options for text-based queries.
 */
export type TextQueryOptions = {
  /** Require exact match (default: false = substring match) */
  exact?: boolean
}

/**
 * Options for role-based queries.
 */
export type RoleQueryOptions = {
  /** Filter by accessible name */
  name?: string
}

/**
 * Error codes for native module calls.
 */
