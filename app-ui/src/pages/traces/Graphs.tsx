import React from "react";

type Transition = {
  from: string;
  to: string;
  weight: number;
};

type Props = {
  data: Transition[];
  size?: number;
};

const CircularToolGraph: React.FC<Props> = ({ data, size = 600 }) => {
  const radius = size / 2 - 60;

  // Compute incoming weight per tool
  const incomingWeight = new Map<string, number>();
  for (const d of data) {
    incomingWeight.set(d.to, (incomingWeight.get(d.to) || 0) + d.weight);
  }

  // Unique tool names sorted to spread heavy nodes
  const uniqueTools = Array.from(new Set(data.flatMap((d) => [d.from, d.to])));
  const toolWeights = uniqueTools.map((name) => ({
    name,
    weight: incomingWeight.get(name) || 0,
  }));
  toolWeights.sort((a, b) => b.weight - a.weight);
  const interleaved: string[] = [];
  let l = 0,
    r = toolWeights.length - 1;
  while (l <= r) {
    if (l === r) interleaved.push(toolWeights[l].name);
    else interleaved.push(toolWeights[l].name, toolWeights[r].name);
    l++;
    r--;
  }
  const toolNames = interleaved;

  const angleStep = (2 * Math.PI) / toolNames.length;

  // Node positions
  const nodePos = new Map<string, { x: number; y: number }>(
    toolNames.map((name, i) => {
      const angle = i * angleStep - Math.PI / 2;
      return [
        name,
        {
          x: size / 2 + radius * Math.cos(angle) + 10,
          y: size / 2 + radius * Math.sin(angle) - 30,
        },
      ];
    })
  );

  const incomingWeights = Array.from(incomingWeight.values());
  const maxIn = Math.max(...incomingWeights, 1);
  const minIn = Math.min(...incomingWeights, 0);

  const maxW = Math.max(...data.map((d) => d.weight), 1);
  const minW = Math.min(...data.map((d) => d.weight), 0);

  return (
    <svg width={size} height={size}>
      <style>
        {`
          .node {
            z-index: 1000;
          }
          .node circle {
            transition: transform 0.3s ease;
          }
          .node text {
            transition: opacity 0.3s ease;
            opacity: 0.5;
            z-index: -1;
          }
          .node text:hover {
            opacity: 1;
          }
          .node:hover circle {
            fill: #3e3aff;
            opacity: 1;
          }
          .node:hover text {
            opacity: 1;
            font-size: 12pt;
            background-color: white;
          }
        `}
      </style>
      {/* Edges */}
      {data.map((d, i) => {
        const from = nodePos.get(d.from);
        const to = nodePos.get(d.to);
        if (!from || !to) return null;

        const norm = (d.weight - minW) / (maxW - minW + 1e-6);
        const strokeWidth = 0.2 + norm * 10;
        const opacity = 0.1 + norm * 0.8;

        return (
          <line
            key={i}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="#8884d8"
            strokeWidth={strokeWidth}
            opacity={opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {/* Nodes */}
      {toolNames.map((name) => {
        const pos = nodePos.get(name)!;
        const w = incomingWeight.get(name) || 0;
        const norm = (w - minIn) / (maxIn - minIn + 1e-6);
        const opacity = 0.1 + norm * 0.9;

        return (
          <g key={name} className="node">
            <circle
              cx={pos.x}
              cy={pos.y}
              r={10}
              fill="#00C49F"
              opacity={opacity}
            />
            <text
              x={pos.x}
              y={pos.y - 15}
              textAnchor="middle"
              fontSize={8}
              fontFamily="sans-serif"
            >
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default CircularToolGraph;
