/**
 * Simple observable state container used to replace global STATE access.
 */

type Listener<T> = (nextState: T, prevState: T) => void;
type StateUpdater<T> = T | ((prevState: T) => T);

export class StateManager<T = any> {
  private _state: T;
  private _listeners: Set<Listener<T>>;

  /**
   * @param initialState - Optional initial state value.
   */
  constructor(initialState: T) {
    this._state = initialState;
    this._listeners = new Set();
  }

  /**
   * Retrieve the current state snapshot.
   */
  getState(): T {
    return this._state;
  }

  /**
   * Replace the current state and notify subscribers.
   * @param nextState - Replacement state or updater function.
   * @returns Updated state tree.
   */
  setState(nextState: StateUpdater<T>): T {
    const previous = this._state;
    const resolved = typeof nextState === "function"
      ? (nextState as (prevState: T) => T)(previous)
      : nextState;
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
   * @param listener - Callback invoked with (nextState, prevState).
   * @returns Unsubscribe function.
   */
  subscribe(listener: Listener<T>): () => void {
    if (typeof listener !== "function") {
      return () => {};
    }
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }
}
