import type { PortConfig } from "./types";

export class OffsetAllocator {
  private usedOffsets: Set<number> = new Set();
  private config: PortConfig;

  constructor(config: PortConfig) {
    this.config = config;
  }

  getDiscoveredPorts(): number[] {
    return [...this.config.discovered];
  }

  getOffsetStep(): number {
    return this.config.offsetStep;
  }

  allocateOffset(): number {
    const step = this.config.offsetStep;
    let offset = step;
    while (this.usedOffsets.has(offset)) {
      offset += step;
    }
    this.usedOffsets.add(offset);
    return offset;
  }

  releaseOffset(offset: number): void {
    this.usedOffsets.delete(offset);
  }

  getPortsForOffset(offset: number): number[] {
    return this.config.discovered.map((port: number) => port + offset);
  }

  /**
   * Update the discovered ports (e.g. after port discovery completes).
   */
  setDiscoveredPorts(ports: number[]): void {
    this.config.discovered = ports;
  }
}
