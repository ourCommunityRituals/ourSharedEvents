/**
 * Display Rotation Module
 *
 * Story E4: Display Safety + Rotation Guard
 *
 * This module manages event rotation on TV/Display surfaces with safety guards:
 * - Only ACTIVE events are displayed (filtered by assetState)
 * - Empty event list shows static "No active events" screen
 * - Rotation timer pauses on backend failure
 * - Prevents infinite loops and crashes
 *
 * INVARIANT: Display never rotates into invalid or unsafe events.
 * INVARIANT: Archived or READY events never appear on Display.
 * INVARIANT: Rotation never crashes due to empty list.
 *
 * @module display/rotation
 * @version 1.0.0
 * @see Story E4 - Display Safety + Rotation Guard
 */

import {
  DisplayErrorStates,
  type ErrorType,
} from './errorStates';

// =============================================================================
// Types
// =============================================================================

/**
 * Asset lifecycle states (must match worker/src/domain/assetState.ts)
 */
export type AssetState = 'DRAFT' | 'READY' | 'ACTIVE' | 'ARCHIVED';

/**
 * Event shape expected by rotation module
 */
export interface RotationEvent {
  id: string;
  name: string;
  assetState: AssetState;
  slug?: string;
  brand?: string;
}

/**
 * Rotation state enum
 */
export type RotationState =
  | 'idle'           // Not started
  | 'rotating'       // Actively rotating through events
  | 'paused'         // Paused due to error or user action
  | 'static'         // Showing static content (e.g., no active events)
  | 'error';         // Backend error state

/**
 * Rotation configuration
 */
export interface RotationConfig {
  /** Time in ms to display each event (default: 30000 = 30s) */
  dwellTimeMs: number;
  /** Time in ms between backend polls (default: 60000 = 1min) */
  pollIntervalMs: number;
  /** Number of retries on backend failure before pausing (default: 3) */
  maxRetries: number;
  /** Backoff multiplier for retries (default: 2) */
  backoffMultiplier: number;
  /** Initial retry delay in ms (default: 5000) */
  initialRetryDelayMs: number;
  /** Maximum retry delay in ms (default: 60000) */
  maxRetryDelayMs: number;
  /** Callback when rotation state changes */
  onStateChange?: (state: RotationState) => void;
  /** Callback when current event changes */
  onEventChange?: (event: RotationEvent | null, index: number) => void;
  /** Callback to render an event */
  onRenderEvent?: (event: RotationEvent) => void;
  /** Callback to render empty state */
  onRenderEmpty?: () => void;
  /** Callback to render error state */
  onRenderError?: (errorType: ErrorType) => void;
}

/**
 * Backend fetch result
 */
export interface FetchEventsResult {
  ok: boolean;
  events?: RotationEvent[];
  error?: {
    code: string;
    message: string;
    status?: number;
  };
}

/**
 * Rotation manager state snapshot
 */
export interface RotationSnapshot {
  state: RotationState;
  events: RotationEvent[];
  activeEvents: RotationEvent[];
  currentIndex: number;
  currentEvent: RotationEvent | null;
  retryCount: number;
  lastError: string | null;
  lastFetchTime: number | null;
}

// =============================================================================
// Constants
// =============================================================================

const VERSION = '1.0.0';

/** Default rotation dwell time: 30 seconds */
const DEFAULT_DWELL_TIME_MS = 30000;

/** Default poll interval: 1 minute */
const DEFAULT_POLL_INTERVAL_MS = 60000;

/** Default max retries before pausing */
const DEFAULT_MAX_RETRIES = 3;

/** Default backoff multiplier */
const DEFAULT_BACKOFF_MULTIPLIER = 2;

/** Default initial retry delay: 5 seconds */
const DEFAULT_INITIAL_RETRY_DELAY_MS = 5000;

/** Default max retry delay: 1 minute */
const DEFAULT_MAX_RETRY_DELAY_MS = 60000;

// =============================================================================
// State Management
// =============================================================================

/**
 * Rotation Manager Class
 *
 * Manages the rotation of events on display surfaces with safety guards.
 */
export class RotationManager {
  private config: RotationConfig;
  private state: RotationState = 'idle';
  private events: RotationEvent[] = [];
  private activeEvents: RotationEvent[] = [];
  private currentIndex = 0;
  private retryCount = 0;
  private currentRetryDelay: number;
  private lastError: string | null = null;
  private lastFetchTime: number | null = null;

  private rotationTimerId: ReturnType<typeof setTimeout> | null = null;
  private pollTimerId: ReturnType<typeof setTimeout> | null = null;
  private retryTimerId: ReturnType<typeof setTimeout> | null = null;

  private fetchEventsFn: () => Promise<FetchEventsResult>;
  private container: HTMLElement | null = null;

  constructor(
    fetchEventsFn: () => Promise<FetchEventsResult>,
    config: Partial<RotationConfig> = {}
  ) {
    this.fetchEventsFn = fetchEventsFn;
    this.config = {
      dwellTimeMs: config.dwellTimeMs ?? DEFAULT_DWELL_TIME_MS,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      backoffMultiplier: config.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER,
      initialRetryDelayMs: config.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS,
      maxRetryDelayMs: config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
      onStateChange: config.onStateChange,
      onEventChange: config.onEventChange,
      onRenderEvent: config.onRenderEvent,
      onRenderEmpty: config.onRenderEmpty,
      onRenderError: config.onRenderError,
    };
    this.currentRetryDelay = this.config.initialRetryDelayMs;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Set the container element for rendering
   */
  setContainer(container: HTMLElement): void {
    this.container = container;
  }

  /**
   * Start rotation
   *
   * Fetches events, filters to ACTIVE only, and begins rotation.
   * If no ACTIVE events, shows static "No active events" screen.
   */
  async start(): Promise<void> {
    this.log('Starting rotation manager');
    await this.fetchAndUpdateEvents();

    if (this.state !== 'error') {
      this.startPolling();
    }
  }

  /**
   * Stop rotation and clean up all timers
   */
  stop(): void {
    this.log('Stopping rotation manager');
    this.clearAllTimers();
    this.setState('idle');
  }

  /**
   * Pause rotation (keeps current event displayed)
   */
  pause(): void {
    if (this.state === 'rotating') {
      this.log('Pausing rotation');
      this.clearRotationTimer();
      this.setState('paused');
    }
  }

  /**
   * Resume rotation from paused state
   */
  resume(): void {
    if (this.state === 'paused' && this.activeEvents.length > 0) {
      this.log('Resuming rotation');
      this.setState('rotating');
      this.scheduleNextRotation();
    }
  }

  /**
   * Force refresh events from backend
   */
  async refresh(): Promise<void> {
    this.log('Force refreshing events');
    await this.fetchAndUpdateEvents();
  }

  /**
   * Get current state snapshot
   */
  getSnapshot(): RotationSnapshot {
    return {
      state: this.state,
      events: [...this.events],
      activeEvents: [...this.activeEvents],
      currentIndex: this.currentIndex,
      currentEvent: this.activeEvents[this.currentIndex] ?? null,
      retryCount: this.retryCount,
      lastError: this.lastError,
      lastFetchTime: this.lastFetchTime,
    };
  }

  /**
   * Get current event being displayed
   */
  getCurrentEvent(): RotationEvent | null {
    return this.activeEvents[this.currentIndex] ?? null;
  }

  /**
   * Get count of active events
   */
  getActiveEventCount(): number {
    return this.activeEvents.length;
  }

  // ===========================================================================
  // Event Filtering
  // ===========================================================================

  /**
   * Filter events to only include ACTIVE events
   *
   * Story E4 INVARIANT: Only ACTIVE events appear on Display
   *
   * @param events - All events from backend
   * @returns Only events with assetState === 'ACTIVE'
   */
  filterActiveEvents(events: RotationEvent[]): RotationEvent[] {
    const activeEvents = events.filter((event) => event.assetState === 'ACTIVE');

    this.log(`Filtered ${events.length} events to ${activeEvents.length} ACTIVE events`);

    // Log any filtered-out events for debugging
    const nonActive = events.filter((event) => event.assetState !== 'ACTIVE');
    if (nonActive.length > 0) {
      console.log(
        JSON.stringify({
          type: 'ROTATION_FILTERED_EVENTS',
          filteredCount: nonActive.length,
          filteredStates: nonActive.map((e) => ({
            id: e.id,
            name: e.name,
            assetState: e.assetState,
          })),
          timestamp: new Date().toISOString(),
        })
      );
    }

    return activeEvents;
  }

  // ===========================================================================
  // Backend Communication
  // ===========================================================================

  /**
   * Fetch events from backend and update internal state
   */
  private async fetchAndUpdateEvents(): Promise<void> {
    try {
      this.log('Fetching events from backend');
      const result = await this.fetchEventsFn();
      this.lastFetchTime = Date.now();

      if (!result.ok) {
        this.handleBackendError(result.error);
        return;
      }

      // Reset retry state on success
      this.retryCount = 0;
      this.currentRetryDelay = this.config.initialRetryDelayMs;
      this.lastError = null;

      // Store all events but filter to active only
      this.events = result.events ?? [];
      this.activeEvents = this.filterActiveEvents(this.events);

      this.updateDisplayState();
    } catch (error) {
      this.handleBackendError({
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Handle backend error with retry logic
   *
   * Story E4: Rotation timer must pause on backend failure
   */
  private handleBackendError(error?: { code: string; message: string; status?: number }): void {
    const errorMsg = error?.message ?? 'Unknown backend error';
    const errorCode = error?.code ?? 'UNKNOWN';

    this.log(`Backend error: ${errorCode} - ${errorMsg}`);
    this.lastError = errorMsg;
    this.retryCount++;

    console.log(
      JSON.stringify({
        type: 'ROTATION_BACKEND_ERROR',
        errorCode,
        errorMessage: errorMsg,
        retryCount: this.retryCount,
        maxRetries: this.config.maxRetries,
        timestamp: new Date().toISOString(),
      })
    );

    // Check if we should retry
    if (this.retryCount <= this.config.maxRetries) {
      this.log(`Scheduling retry ${this.retryCount}/${this.config.maxRetries} in ${this.currentRetryDelay}ms`);

      // Pause rotation during retry
      this.clearRotationTimer();

      this.retryTimerId = setTimeout(() => {
        this.fetchAndUpdateEvents();
      }, this.currentRetryDelay);

      // Exponential backoff
      this.currentRetryDelay = Math.min(
        this.currentRetryDelay * this.config.backoffMultiplier,
        this.config.maxRetryDelayMs
      );
    } else {
      // Max retries exceeded - enter error state
      this.log('Max retries exceeded, entering error state');
      this.clearAllTimers();
      this.setState('error');

      // Render error state
      this.renderErrorState(this.classifyBackendError(error));
    }
  }

  /**
   * Classify backend error for display
   */
  private classifyBackendError(error?: { code: string; message: string; status?: number }): ErrorType {
    if (!error) return 'UNKNOWN';

    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
      return 'NETWORK_ERROR';
    }

    if (error.status && error.status >= 500) {
      return 'BACKEND_ERROR';
    }

    if (error.status === 404) {
      return 'NOT_FOUND';
    }

    return 'BACKEND_ERROR';
  }

  // ===========================================================================
  // Display State Management
  // ===========================================================================

  /**
   * Update display based on current event list
   *
   * Story E4 Guards:
   * - Empty list → static "No active events" state
   * - Non-empty list → begin/continue rotation
   */
  private updateDisplayState(): void {
    if (this.activeEvents.length === 0) {
      // GUARD: Empty list → show static state
      this.log('No active events - showing static state');
      this.clearRotationTimer();
      this.currentIndex = 0;
      this.setState('static');
      this.renderEmptyState();
    } else {
      // Ensure current index is valid (prevents crashes)
      if (this.currentIndex >= this.activeEvents.length) {
        this.currentIndex = 0;
      }

      // Start or continue rotation
      if (this.state !== 'paused') {
        this.setState('rotating');
        this.renderCurrentEvent();
        this.scheduleNextRotation();
      }
    }
  }

  // ===========================================================================
  // Rotation Logic
  // ===========================================================================

  /**
   * Schedule the next rotation
   */
  private scheduleNextRotation(): void {
    this.clearRotationTimer();

    // GUARD: Don't schedule if no events or not rotating
    if (this.activeEvents.length === 0 || this.state !== 'rotating') {
      return;
    }

    // GUARD: Single event - no need to rotate
    if (this.activeEvents.length === 1) {
      this.log('Single active event - rotation disabled');
      return;
    }

    this.rotationTimerId = setTimeout(() => {
      this.rotateToNext();
    }, this.config.dwellTimeMs);
  }

  /**
   * Rotate to the next event
   *
   * GUARD: Wraps around safely, never exceeds bounds
   */
  private rotateToNext(): void {
    if (this.activeEvents.length === 0) {
      return;
    }

    // Safe modulo wrap-around
    this.currentIndex = (this.currentIndex + 1) % this.activeEvents.length;

    this.log(`Rotating to event ${this.currentIndex + 1}/${this.activeEvents.length}`);

    this.renderCurrentEvent();
    this.scheduleNextRotation();
  }

  // ===========================================================================
  // Rendering
  // ===========================================================================

  /**
   * Render the current event
   */
  private renderCurrentEvent(): void {
    const event = this.activeEvents[this.currentIndex];

    if (!event) {
      this.log('No event to render at current index');
      return;
    }

    this.log(`Rendering event: ${event.id} (${event.name})`);

    // Notify callback
    this.config.onEventChange?.(event, this.currentIndex);
    this.config.onRenderEvent?.(event);
  }

  /**
   * Render empty state (no active events)
   *
   * Story E4: Show static "No active events" screen
   */
  private renderEmptyState(): void {
    this.log('Rendering empty state');

    // Clear any existing error state
    if (this.container) {
      DisplayErrorStates.clearErrorState(this.container);
    }

    // Notify callback
    this.config.onEventChange?.(null, -1);
    this.config.onRenderEmpty?.();

    // Render default empty state if container and no custom callback
    if (this.container && !this.config.onRenderEmpty) {
      this.renderDefaultEmptyState();
    }
  }

  /**
   * Render default empty state UI
   */
  private renderDefaultEmptyState(): void {
    if (!this.container) return;

    const html = `
      <div class="rotation-empty-state" data-testid="no-active-events">
        <div class="rotation-empty-content">
          <span class="rotation-empty-icon">📺</span>
          <h2 class="rotation-empty-title">No Active Events</h2>
          <p class="rotation-empty-message">Waiting for events to become available...</p>
        </div>
      </div>
      <style>
        .rotation-empty-state {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          color: white;
          text-align: center;
        }
        .rotation-empty-content {
          max-width: 600px;
          padding: 40px;
        }
        .rotation-empty-icon {
          font-size: 4rem;
          display: block;
          margin-bottom: 24px;
        }
        .rotation-empty-title {
          font-size: 2.5rem;
          font-weight: 600;
          margin: 0 0 16px 0;
        }
        .rotation-empty-message {
          font-size: 1.25rem;
          color: #94a3b8;
          margin: 0;
        }
      </style>
    `;

    this.container.innerHTML = html;
  }

  /**
   * Render error state
   */
  private renderErrorState(errorType: ErrorType): void {
    this.log(`Rendering error state: ${errorType}`);

    // Notify callback
    this.config.onRenderError?.(errorType);

    // Use DisplayErrorStates for error rendering if container available
    if (this.container && !this.config.onRenderError) {
      DisplayErrorStates.renderErrorState({
        container: this.container,
        errorType,
        tvMode: true,
        autoRetry: true,
        retryCallback: () => this.refresh(),
      });
    }
  }

  // ===========================================================================
  // Polling
  // ===========================================================================

  /**
   * Start background polling for event updates
   */
  private startPolling(): void {
    this.clearPollTimer();

    this.pollTimerId = setInterval(() => {
      if (this.state !== 'error') {
        this.fetchAndUpdateEvents();
      }
    }, this.config.pollIntervalMs);
  }

  // ===========================================================================
  // Timer Management
  // ===========================================================================

  private clearRotationTimer(): void {
    if (this.rotationTimerId) {
      clearTimeout(this.rotationTimerId);
      this.rotationTimerId = null;
    }
  }

  private clearPollTimer(): void {
    if (this.pollTimerId) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimerId) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
  }

  private clearAllTimers(): void {
    this.clearRotationTimer();
    this.clearPollTimer();
    this.clearRetryTimer();
  }

  // ===========================================================================
  // State Updates
  // ===========================================================================

  private setState(newState: RotationState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;

      this.log(`State change: ${oldState} → ${newState}`);

      console.log(
        JSON.stringify({
          type: 'ROTATION_STATE_CHANGE',
          from: oldState,
          to: newState,
          activeEventCount: this.activeEvents.length,
          timestamp: new Date().toISOString(),
        })
      );

      this.config.onStateChange?.(newState);
    }
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  private log(message: string): void {
    console.log(`[RotationManager] ${message}`);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a rotation manager with default API fetch function
 *
 * @param apiBaseUrl - Base URL for API calls
 * @param brand - Brand ID for filtering events
 * @param config - Rotation configuration
 * @returns RotationManager instance
 */
export function createRotationManager(
  apiBaseUrl: string,
  brand: string,
  config: Partial<RotationConfig> = {}
): RotationManager {
  const fetchEvents = async (): Promise<FetchEventsResult> => {
    try {
      const url = new URL('/api/v2/events', apiBaseUrl);
      url.searchParams.set('brand', brand);

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          ok: false,
          error: {
            code: errorBody.code || 'HTTP_ERROR',
            message: errorBody.message || `HTTP ${response.status}`,
            status: response.status,
          },
        };
      }

      const data = await response.json();

      // Map API response to RotationEvent format
      const events: RotationEvent[] = (data.items || []).map((item: Record<string, unknown>) => ({
        id: item.id as string,
        name: item.name as string,
        assetState: (item.assetState as AssetState) || 'DRAFT',
        slug: item.slug as string | undefined,
        brand: item.brand as string | undefined,
      }));

      return { ok: true, events };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network request failed',
        },
      };
    }
  };

  return new RotationManager(fetchEvents, config);
}

// =============================================================================
// Export Module
// =============================================================================

/**
 * Display Rotation Module
 * Story E4: Display Safety + Rotation Guard
 */
export const DisplayRotation = {
  VERSION,

  // Manager class
  RotationManager,

  // Factory function
  createRotationManager,

  // Default configuration values
  DEFAULT_DWELL_TIME_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_MAX_RETRIES,
};

// Also export as default for ES module usage
export default DisplayRotation;

// Export for CommonJS/IIFE compatibility
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).DisplayRotation = DisplayRotation;
}
