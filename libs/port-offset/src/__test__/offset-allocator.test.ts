import { OffsetAllocator } from "../offset-allocator";

describe("OffsetAllocator", () => {
  describe("getDiscoveredPorts", () => {
    it("returns a copy of discovered ports", () => {
      const allocator = new OffsetAllocator({ discovered: [3000, 4000], offsetStep: 10 });

      expect(allocator.getDiscoveredPorts()).toEqual([3000, 4000]);
    });

    it("returns an independent copy that does not mutate the original", () => {
      const allocator = new OffsetAllocator({ discovered: [3000], offsetStep: 10 });

      const ports = allocator.getDiscoveredPorts();
      ports.push(9999);

      expect(allocator.getDiscoveredPorts()).toEqual([3000]);
    });

    it("returns empty array when no ports discovered", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 10 });

      expect(allocator.getDiscoveredPorts()).toEqual([]);
    });
  });

  describe("getOffsetStep", () => {
    it("returns the configured offset step", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 10 });

      expect(allocator.getOffsetStep()).toBe(10);
    });

    it("returns different step values", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 100 });

      expect(allocator.getOffsetStep()).toBe(100);
    });
  });

  describe("allocateOffset", () => {
    it("allocates first offset equal to offsetStep", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 10 });

      expect(allocator.allocateOffset()).toBe(10);
    });

    it("allocates sequential offsets (1*step, 2*step, 3*step)", () => {
      const allocator = new OffsetAllocator({ discovered: [3000], offsetStep: 10 });

      expect(allocator.allocateOffset()).toBe(10);
      expect(allocator.allocateOffset()).toBe(20);
      expect(allocator.allocateOffset()).toBe(30);
    });

    it("reuses released offsets before allocating new ones", () => {
      const allocator = new OffsetAllocator({ discovered: [3000], offsetStep: 10 });

      const first = allocator.allocateOffset(); // 10
      allocator.allocateOffset(); // 20
      allocator.releaseOffset(first);

      expect(allocator.allocateOffset()).toBe(10);
    });

    it("fills the lowest gap first", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 5 });

      allocator.allocateOffset(); // 5
      const second = allocator.allocateOffset(); // 10
      allocator.allocateOffset(); // 15
      allocator.releaseOffset(second); // release 10

      expect(allocator.allocateOffset()).toBe(10);
      expect(allocator.allocateOffset()).toBe(20);
    });

    it("handles step of 1 correctly", () => {
      const allocator = new OffsetAllocator({ discovered: [3000], offsetStep: 1 });

      expect(allocator.allocateOffset()).toBe(1);
      expect(allocator.allocateOffset()).toBe(2);
      expect(allocator.allocateOffset()).toBe(3);
    });
  });

  describe("releaseOffset", () => {
    it("releases an offset so it can be reallocated", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 10 });

      const offset = allocator.allocateOffset();
      allocator.releaseOffset(offset);

      expect(allocator.allocateOffset()).toBe(offset);
    });

    it("does not error when releasing an offset that was never allocated", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 10 });

      expect(() => allocator.releaseOffset(999)).not.toThrow();
    });

    it("allows multiple release-reallocate cycles", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 10 });

      const offset = allocator.allocateOffset(); // 10
      allocator.releaseOffset(offset);
      expect(allocator.allocateOffset()).toBe(10);
      allocator.releaseOffset(10);
      expect(allocator.allocateOffset()).toBe(10);
    });
  });

  describe("getPortsForOffset", () => {
    it("adds offset to each discovered port", () => {
      const allocator = new OffsetAllocator({ discovered: [3000, 4000, 5000], offsetStep: 10 });

      expect(allocator.getPortsForOffset(10)).toEqual([3010, 4010, 5010]);
    });

    it("returns empty array when no discovered ports", () => {
      const allocator = new OffsetAllocator({ discovered: [], offsetStep: 10 });

      expect(allocator.getPortsForOffset(10)).toEqual([]);
    });

    it("handles single port", () => {
      const allocator = new OffsetAllocator({ discovered: [8080], offsetStep: 10 });

      expect(allocator.getPortsForOffset(20)).toEqual([8100]);
    });
  });
});
