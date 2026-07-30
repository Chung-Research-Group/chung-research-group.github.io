import assert from "node:assert/strict";
import test from "node:test";

await import("../force-layout.js");

const { layoutForceGraph } = globalThis.MTAP_FORCE_LAYOUT;

const nodes = [
  { id: "pi", publicationCount: 72, radius: 27 },
  { id: "a", publicationCount: 28, radius: 21 },
  { id: "b", publicationCount: 24, radius: 20 },
  { id: "c", publicationCount: 18, radius: 19 },
  { id: "d", publicationCount: 14, radius: 18 },
  { id: "e", publicationCount: 12, radius: 17 },
  { id: "f", publicationCount: 9, radius: 16 },
  { id: "g", publicationCount: 7, radius: 15 },
  { id: "h", publicationCount: 5, radius: 14 },
  { id: "i", publicationCount: 3, radius: 13 }
];

const edges = [
  { source: "pi", target: "a", publicationCount: 18 },
  { source: "pi", target: "b", publicationCount: 14 },
  { source: "pi", target: "c", publicationCount: 11 },
  { source: "pi", target: "d", publicationCount: 9 },
  { source: "pi", target: "e", publicationCount: 7 },
  { source: "pi", target: "f", publicationCount: 6 },
  { source: "pi", target: "g", publicationCount: 5 },
  { source: "pi", target: "h", publicationCount: 4 },
  { source: "pi", target: "i", publicationCount: 2 },
  { source: "a", target: "b", publicationCount: 6 },
  { source: "a", target: "d", publicationCount: 4 },
  { source: "b", target: "e", publicationCount: 3 },
  { source: "c", target: "f", publicationCount: 4 },
  { source: "d", target: "g", publicationCount: 2 },
  { source: "e", target: "h", publicationCount: 2 },
  { source: "f", target: "i", publicationCount: 2 }
];

test("force layout is deterministic, bounded, collision-aware, and not fixed-ring geometry", () => {
  const options = {
    focalId: "pi",
    seed: "unit-test-network",
    width: 1000,
    height: 680
  };
  const first = layoutForceGraph(nodes, edges, options);
  const repeated = layoutForceGraph(nodes, edges, options);
  const reordered = layoutForceGraph([...nodes].reverse(), [...edges].reverse(), options);

  assert.deepEqual(repeated, first);
  assert.deepEqual(reordered, first);
  assert.equal(first.method, "deterministic-force-v1");
  assert.equal(first.width, 1000);
  assert.equal(first.height, 680);

  const focal = first.nodes.find((node) => node.id === "pi");
  assert.deepEqual(
    { x: focal.x, y: focal.y, anchored: focal.anchored },
    { x: 500, y: 340, anchored: true }
  );

  for (const node of first.nodes) {
    assert.ok(node.x - node.radius >= 0, `${node.id} circle crosses the left viewBox edge`);
    assert.ok(node.x + node.radius <= first.width, `${node.id} circle crosses the right viewBox edge`);
    assert.ok(node.y - node.radius >= 0, `${node.id} circle crosses the top viewBox edge`);
    assert.ok(node.y + node.radius <= first.height, `${node.id} circle crosses the bottom viewBox edge`);
  }

  for (let leftIndex = 0; leftIndex < first.nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < first.nodes.length; rightIndex += 1) {
      const left = first.nodes[leftIndex];
      const right = first.nodes[rightIndex];
      const distance = Math.hypot(right.x - left.x, right.y - left.y);
      assert.ok(
        distance + 0.01 >= left.radius + right.radius,
        `${left.id} and ${right.id} overlap`
      );
    }
  }

  const collaboratorRadii = first.nodes
    .filter((node) => node.id !== focal.id)
    .map((node) => Math.hypot(node.x - focal.x, node.y - focal.y));
  const roundedRadii = new Set(collaboratorRadii.map((radius) => Math.round(radius)));
  assert.ok(roundedRadii.size > 2, "force layout collapsed into two concentric rings");
  assert.equal(
    collaboratorRadii.every((radius) => Math.abs(radius - 170) < 0.5 || Math.abs(radius - 280) < 0.5),
    false
  );

  const alternateSeed = layoutForceGraph(nodes, edges, { ...options, seed: "alternate-network" });
  assert.notDeepEqual(
    alternateSeed.nodes.map(({ id, x, y }) => ({ id, x, y })),
    first.nodes.map(({ id, x, y }) => ({ id, x, y }))
  );
});
