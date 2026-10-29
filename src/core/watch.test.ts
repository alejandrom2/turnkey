import { describe, expect, it, vi } from "vitest";

import type { Machine } from "./t3/machine.js";
import { MachineWatch } from "./watch.js";

const machine = (url: string) => ({ url }) as unknown as Machine;

describe("MachineWatch", () => {
  it("subscribes again to a machine removed and added back under the same address", () => {
    const released: string[] = [];
    const opened: Machine[] = [];
    const watch = new MachineWatch(
      {
        open: (target) => {
          opened.push(target);
          return () => released.push(target.url);
        },
      },
      () => undefined,
    );
    const first = machine("http://a");
    let shown = [first];
    watch.show("key", () => shown);
    expect(opened).toEqual([first]);

    const again = machine("http://a");
    shown = [again];
    watch.sync();
    expect(released).toEqual(["http://a"]);
    expect(opened[1]).toBe(again);
    expect(watch.machines()).toEqual([again]);
  });

  it("ticks once a minute only while an instance shows", () => {
    vi.useFakeTimers();
    try {
      const watch = new MachineWatch(
        { open: () => () => undefined },
        () => undefined,
      );
      const tick = vi.fn();
      watch.onTick(tick);
      watch.show("key", () => [machine("http://a")]);
      vi.advanceTimersByTime(60_000);
      expect(tick).toHaveBeenCalledTimes(1);
      watch.hide("key");
      vi.advanceTimersByTime(120_000);
      expect(tick).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
