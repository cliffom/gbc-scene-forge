/** Resources owned by one mounted editor. No work starts at module import time. */
export class EditorLifetime {
  private controller = new AbortController();
  private cleanups: (() => void)[] = [];
  private bindings = new WeakMap<object, Map<PropertyKey, () => void>>();
  private targets = new Set<WeakRef<object>>();
  private finalizers = new FinalizationRegistry<WeakRef<object>>((reference) => {
    this.targets.delete(reference);
  });
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private intervals = new Set<ReturnType<typeof setInterval>>();
  private urls = new Set<string>();
  private captures = new Map<Element, Set<number>>();
  private frames = new Set<number>();

  get signal() {
    return this.controller.signal;
  }
  get disposed() {
    return this.signal.aborted;
  }
  cleanup(callback: () => void) {
    if (this.disposed) {
      callback();
    } else {
      this.cleanups.push(callback);
    }
  }
  /** Weak ownership allows rebuilt palette/list controls to be collected normally. */
  assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
    if (this.disposed) {
      return value;
    }
    let bindings = this.bindings.get(target);
    if (!bindings) {
      bindings = new Map();
      this.bindings.set(target, bindings);
      const reference = new WeakRef(target);
      this.targets.add(reference);
      this.finalizers.register(target, reference, reference);
    }
    if (!bindings.has(key)) {
      const previous = target[key];
      bindings.set(key, () => {
        target[key] = previous;
      });
    }
    target[key] = value;
    return value;
  }
  timeout(callback: () => void, milliseconds: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed) {
        callback();
      }
    }, milliseconds);
    if (this.disposed) {
      clearTimeout(timer);
    } else {
      this.timers.add(timer);
    }
    return timer;
  }
  interval(callback: () => void, milliseconds: number) {
    const timer = setInterval(() => {
      if (!this.disposed) {
        callback();
      }
    }, milliseconds);
    if (this.disposed) {
      clearInterval(timer);
    } else {
      this.intervals.add(timer);
    }
    return timer;
  }
  frame(callback: FrameRequestCallback) {
    const frame = requestAnimationFrame((time) => {
      this.frames.delete(frame);
      if (!this.disposed) {
        callback(time);
      }
    });
    if (this.disposed) {
      cancelAnimationFrame(frame);
    } else {
      this.frames.add(frame);
    }
    return frame;
  }
  revokeLater(url: string) {
    if (this.disposed) {
      URL.revokeObjectURL(url);
      return;
    }
    this.urls.add(url);
    this.timeout(() => {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
    }, 1000);
  }
  capture(target: Element, pointer: number) {
    target.setPointerCapture(pointer);
    let pointers = this.captures.get(target);
    if (!pointers) {
      pointers = new Set();
      this.captures.set(target, pointers);
      target.addEventListener(
        'lostpointercapture',
        (event) => {
          if (event instanceof PointerEvent && event.target === target) {
            this.captures.get(target)?.delete(event.pointerId);
          }
        },
        { signal: this.signal },
      );
    }
    pointers.add(pointer);
  }
  cancelFrame(frame: number) {
    cancelAnimationFrame(frame);
    this.frames.delete(frame);
  }
  cancelTimeout(timer: ReturnType<typeof setTimeout> | undefined) {
    clearTimeout(timer);
    if (timer !== undefined) {
      this.timers.delete(timer);
    }
  }
  observe<T extends { disconnect(): void }>(observer: T): T {
    this.cleanup(() => observer.disconnect());
    return observer;
  }
  dispose() {
    if (this.disposed) {
      return;
    }
    this.controller.abort();
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    for (const timer of this.intervals) {
      clearInterval(timer);
    }
    for (const frame of this.frames) {
      cancelAnimationFrame(frame);
    }
    for (const [target, pointers] of this.captures) {
      for (const pointer of pointers) {
        if (target.hasPointerCapture(pointer)) {
          target.releasePointerCapture(pointer);
        }
      }
    }
    this.captures.clear();
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
    for (const callback of this.cleanups.reverse()) {
      callback();
    }
    for (const reference of this.targets) {
      this.finalizers.unregister(reference);
      const target = reference.deref();
      if (target) {
        for (const restore of this.bindings.get(target)?.values() ?? []) {
          restore();
        }
      }
    }
    this.timers.clear();
    this.intervals.clear();
    this.frames.clear();
    this.cleanups = [];
    this.targets.clear();
    this.bindings = new WeakMap();
  }
}
