import type { Collector } from "../types";

export function createCollector(): Collector {
  return {
    variables: {},
    loopPath: [],
  };
}
