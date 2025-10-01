"use strict";

/**
 * Simple observable state container used to replace global STATE access.
 */
export class StateManager {
  /**
   * @param {object} [initialState={}] - Optional initial state value.
   */
  constructor(initialState = {}) {
    this._state = initialState;
    this._listeners = new Set();
  }

  /**
   * Retrieve the current state snapshot.
   * @returns {object} Current state tree.
   */
  getState() {
    return this._state;
  }

  /**
   * Replace the current state and notify subscribers.
   * @param {object|Function} nextState - Replacement state or updater function.
   * @returns {object} Updated state tree.
   */
  setState(nextState) {
    const previous = this._state;
    const resolved =
      typeof nextState === "function" ? nextState(previous) : nextState;
    this._state = resolved;
    for (const listener of this._listeners) {
      try {
        listener(this._state, previous);
      } catch {
        // Ignore listener errors to avoid cascading failures.
      }
    }
    return this._state;
  }

  /**
   * Subscribe to state change notifications.
   * @param {Function} listener - Callback invoked with (nextState, prevState).
   * @returns {Function} Unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }
}

