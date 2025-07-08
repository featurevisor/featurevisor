export type EventName = "datafile_set" | "context_set" | "sticky_set";

export type EventDetails = Record<string, unknown>;

export type EventCallback = (details: EventDetails) => void;

export type Listeners = Record<EventName, EventCallback[]> | {};

export class Emitter {
  listeners: Listeners;

  constructor() {
    this.listeners = {};
  }

  on(eventName: EventName, callback: EventCallback) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }

    const listeners = this.listeners[eventName];
    listeners.push(callback);

    const self = this;
    let isActive = true;

    return function unsubscribe() {
      if (!isActive) {
        return;
      }

      isActive = false;

      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  trigger(eventName: EventName, details: EventDetails = {}) {
    const listeners = this.listeners[eventName];

    if (!listeners) {
      return;
    }

    listeners.forEach(function (listener) {
      try {
        listener(details);
      } catch (err) {
        console.error(err);
      }
    });
  }

  clearAll() {
    this.listeners = {};
  }
}
