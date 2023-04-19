export type EventName = "ready" | "refresh" | "update" | "activation";

export interface Listeners {
  [key: string]: Function[];
}

export class Emitter {
  private _listeners: Listeners;

  constructor() {
    this._listeners = {};
  }

  public addListener(eventName: EventName, fn: Function): void {
    if (typeof this._listeners[eventName] === "undefined") {
      this._listeners[eventName] = [];
    }

    this._listeners[eventName].push(fn);
  }

  public removeListener(eventName: EventName, fn: Function): void {
    if (typeof this._listeners[eventName] === "undefined") {
      return;
    }

    const index = this._listeners[eventName].indexOf(fn);

    if (index !== -1) {
      this._listeners[eventName].splice(index, 1);
    }
  }

  public removeAllListeners(eventName?: EventName): void {
    if (eventName) {
      this._listeners[eventName] = [];
    } else {
      Object.keys(this._listeners).forEach((key) => {
        this._listeners[key] = [];
      });
    }
  }

  public emit(eventName: EventName, ...args: any[]): void {
    if (typeof this._listeners[eventName] === "undefined") {
      return;
    }

    this._listeners[eventName].forEach((fn) => {
      fn(...args);
    });
  }
}
