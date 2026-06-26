import type { EventDetailsByName } from "./events.js";

export type EventName = keyof EventDetailsByName;

export type EventDetails = EventDetailsByName[EventName];

export type EventCallback<TEventName extends EventName = EventName> = (
  details: EventDetailsByName[TEventName],
) => void;

export type Listeners = {
  [TEventName in EventName]?: EventCallback<TEventName>[];
};

export class Emitter {
  listeners: Listeners;

  constructor() {
    this.listeners = {};
  }

  on<TEventName extends EventName>(
    eventName: TEventName,
    callback: EventCallback<TEventName>,
  ): () => void {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }

    const listeners = this.listeners[eventName] as EventCallback<TEventName>[];
    listeners.push(callback);

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

  trigger<TEventName extends EventName>(
    eventName: TEventName,
    details: EventDetailsByName[TEventName],
  ) {
    const listeners = this.listeners[eventName];

    if (!listeners) {
      return;
    }

    listeners.slice().forEach(function (listener) {
      try {
        listener(details as never);
      } catch (err) {
        console.error(err);
      }
    });
  }

  clearAll() {
    this.listeners = {};
  }
}
