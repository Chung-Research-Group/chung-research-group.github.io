(function attachForceLayout(root) {
  "use strict";

  const DEFAULTS = Object.freeze({
    width: 1000,
    height: 680,
    iterations: 500,
    paddingX: 82,
    paddingTop: 32,
    paddingBottom: 32,
    collisionPadding: 24,
    chargeStrength: 34000,
    centerStrength: 0.0025,
    linkStrength: 0.011,
    velocityRetention: 0.81
  });

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positiveNumber(value, fallback) {
    const number = finiteNumber(value, fallback);
    return number > 0 ? number : fallback;
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    let state = seed >>> 0;
    return function nextRandom() {
      state = state + 0x6D2B79F5 | 0;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function canonicalEdge(edge) {
    const source = String(edge?.source || "");
    const target = String(edge?.target || "");
    return source < target
      ? { source, target }
      : { source: target, target: source };
  }

  function graphSeed(nodes, edges, requestedSeed) {
    const nodeText = nodes
      .map((node) => `${node.id}:${node.publicationCount}:${node.radius}`)
      .sort()
      .join("|");
    const edgeText = edges
      .map((edge) => {
        const canonical = canonicalEdge(edge);
        return `${canonical.source}:${canonical.target}:${edge.publicationCount}`;
      })
      .sort()
      .join("|");
    return hashText(`${requestedSeed || "coauthor-force-v1"}\u0000${nodeText}\u0000${edgeText}`);
  }

  function clampNode(node, settings) {
    const horizontalMargin = Math.max(settings.paddingX, node.radius + 8);
    const minimumY = Math.max(settings.paddingTop + node.radius, node.radius + 8);
    const maximumY = settings.height - settings.paddingBottom - node.radius;
    node.x = Math.min(settings.width - horizontalMargin, Math.max(horizontalMargin, node.x));
    node.y = Math.min(maximumY, Math.max(minimumY, node.y));
  }

  function separateCoincidentNodes(left, right, seed) {
    const angle = (hashText(`${seed}\u0000${left.id}\u0000${right.id}`) / 4294967296) * Math.PI * 2;
    return {
      dx: Math.cos(angle) * 0.01,
      dy: Math.sin(angle) * 0.01,
      distance: 0.01
    };
  }

  function layoutForceGraph(rawNodes, rawEdges, options = {}) {
    const settings = {
      ...DEFAULTS,
      ...options,
      width: positiveNumber(options.width, DEFAULTS.width),
      height: positiveNumber(options.height, DEFAULTS.height),
      iterations: Math.max(1, Math.floor(positiveNumber(options.iterations, DEFAULTS.iterations)))
    };
    const inputNodes = (Array.isArray(rawNodes) ? rawNodes : [])
      .filter((node) => node && String(node.id || "").trim())
      .map((node) => ({
        id: String(node.id).trim(),
        publicationCount: Math.max(0, finiteNumber(node.publicationCount, 0)),
        radius: Math.max(4, positiveNumber(node.radius, 12)),
        anchored: node.id === options.focalId
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!inputNodes.length) {
      return {
        method: "deterministic-force-v1",
        seed: 0,
        width: settings.width,
        height: settings.height,
        nodes: [],
        edges: []
      };
    }

    const idSet = new Set(inputNodes.map((node) => node.id));
    const edges = (Array.isArray(rawEdges) ? rawEdges : [])
      .filter((edge) => edge && idSet.has(edge.source) && idSet.has(edge.target) && edge.source !== edge.target)
      .map((edge) => ({
        source: String(edge.source),
        target: String(edge.target),
        publicationCount: Math.max(1, positiveNumber(edge.publicationCount, 1))
      }))
      .sort((left, right) => {
        const leftEdge = canonicalEdge(left);
        const rightEdge = canonicalEdge(right);
        return leftEdge.source.localeCompare(rightEdge.source)
          || leftEdge.target.localeCompare(rightEdge.target)
          || left.publicationCount - right.publicationCount;
      });
    const seed = graphSeed(inputNodes, edges, options.seed);
    const random = seededRandom(seed);
    const centerX = settings.width / 2;
    const centerY = settings.height / 2;
    const nodes = inputNodes.map((node) => {
      if (node.anchored) {
        return { ...node, x: centerX, y: centerY, vx: 0, vy: 0 };
      }
      const angle = random() * Math.PI * 2;
      const radialScale = 0.22 + Math.sqrt(random()) * 0.62;
      const xRadius = (settings.width / 2 - settings.paddingX) * radialScale;
      const yRadius = (settings.height / 2 - settings.paddingBottom) * radialScale;
      const positioned = {
        ...node,
        x: centerX + Math.cos(angle) * xRadius,
        y: centerY + Math.sin(angle) * yRadius,
        vx: (random() - 0.5) * 0.2,
        vy: (random() - 0.5) * 0.2
      };
      clampNode(positioned, settings);
      return positioned;
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const resolvedEdges = edges.map((edge) => ({
      ...edge,
      sourceNode: byId.get(edge.source),
      targetNode: byId.get(edge.target)
    }));

    for (let iteration = 0; iteration < settings.iterations; iteration += 1) {
      const progress = iteration / settings.iterations;
      const alpha = Math.max(0.025, (1 - progress) ** 1.65);

      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        const left = nodes[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          const right = nodes[rightIndex];
          let dx = right.x - left.x;
          let dy = right.y - left.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 0.01) {
            ({ dx, dy, distance } = separateCoincidentNodes(left, right, seed));
          }
          const unitX = dx / distance;
          const unitY = dy / distance;
          const repulsion = settings.chargeStrength * alpha / Math.max(64, distance * distance);
          if (!left.anchored) {
            left.vx -= unitX * repulsion;
            left.vy -= unitY * repulsion;
          }
          if (!right.anchored) {
            right.vx += unitX * repulsion;
            right.vy += unitY * repulsion;
          }
        }
      }

      for (const edge of resolvedEdges) {
        const source = edge.sourceNode;
        const target = edge.targetNode;
        let dx = target.x - source.x;
        let dy = target.y - source.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          ({ dx, dy, distance } = separateCoincidentNodes(source, target, seed));
        }
        const idealDistance = 245 - Math.min(80, Math.log2(edge.publicationCount + 1) * 26);
        const weightedStrength = settings.linkStrength * (1 + Math.log2(edge.publicationCount + 1) * 0.2);
        const force = (distance - idealDistance) * weightedStrength * alpha;
        const forceX = dx / distance * force;
        const forceY = dy / distance * force;
        if (!source.anchored) {
          source.vx += forceX;
          source.vy += forceY;
        }
        if (!target.anchored) {
          target.vx -= forceX;
          target.vy -= forceY;
        }
      }

      for (const node of nodes) {
        if (node.anchored) continue;
        node.vx += (centerX - node.x) * settings.centerStrength * alpha;
        node.vy += (centerY - node.y) * settings.centerStrength * alpha;
        node.vx *= settings.velocityRetention;
        node.vy *= settings.velocityRetention;
        node.x += node.vx;
        node.y += node.vy;
        clampNode(node, settings);
      }

      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        const left = nodes[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          const right = nodes[rightIndex];
          let dx = right.x - left.x;
          let dy = right.y - left.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 0.01) {
            ({ dx, dy, distance } = separateCoincidentNodes(left, right, seed));
          }
          const minimumDistance = left.radius + right.radius + settings.collisionPadding;
          if (distance >= minimumDistance) continue;
          const overlap = minimumDistance - distance;
          const unitX = dx / distance;
          const unitY = dy / distance;
          if (left.anchored) {
            right.x += unitX * overlap;
            right.y += unitY * overlap;
          } else if (right.anchored) {
            left.x -= unitX * overlap;
            left.y -= unitY * overlap;
          } else {
            left.x -= unitX * overlap * 0.5;
            left.y -= unitY * overlap * 0.5;
            right.x += unitX * overlap * 0.5;
            right.y += unitY * overlap * 0.5;
          }
          clampNode(left, settings);
          clampNode(right, settings);
        }
      }

      for (const node of nodes) {
        if (!node.anchored) continue;
        node.x = centerX;
        node.y = centerY;
        node.vx = 0;
        node.vy = 0;
      }
    }

    return {
      method: "deterministic-force-v1",
      seed,
      width: settings.width,
      height: settings.height,
      nodes: nodes.map((node) => ({
        id: node.id,
        x: Number(node.x.toFixed(3)),
        y: Number(node.y.toFixed(3)),
        radius: Number(node.radius.toFixed(3)),
        anchored: node.anchored
      })),
      edges: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        publicationCount: edge.publicationCount
      }))
    };
  }

  root.MTAP_FORCE_LAYOUT = Object.freeze({
    DEFAULTS,
    layoutForceGraph
  });
})(typeof globalThis === "object" ? globalThis : this);
