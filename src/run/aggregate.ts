export interface Aggregator<T> {
  push(item: T): void | Promise<void>;
  stop(): void;
}

export interface AggregatorOptions<T> {
  windowMs: number;
  deliver: (items: T[]) => void | Promise<void>;
  onError: (error: unknown) => void;
}

export function createAggregator<T>({ windowMs, deliver, onError }: AggregatorOptions<T>): Aggregator<T> {
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const send = async (items: T[]) => {
    await deliver(items);
  };

  const flush = () => {
    timer = undefined;
    if (pending.length === 0) {
      return;
    }
    const items = pending;
    pending = [];
    void send(items).catch(onError);
  };

  return {
    push(item) {
      if (stopped) {
        return;
      }
      if (windowMs === 0) {
        return send([item]);
      }
      pending.push(item);
      if (timer === undefined) {
        timer = setTimeout(flush, windowMs);
        timer.unref?.();
      }
    },
    stop() {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending = [];
    },
  };
}
