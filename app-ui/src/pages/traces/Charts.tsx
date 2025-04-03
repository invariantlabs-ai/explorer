import React from "react";
import { useNavigate } from "react-router-dom";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#A28DFF",
  "#FF6666",
];

export const IssuePieChart = (props) => {
  const navigate = useNavigate();

  const rawData = props.data;

  if (!rawData) {
    return null;
  }

  const data = rawData.map((cluster, index) => ({
    name: cluster.name,
    value: Array.from(
      new Set(cluster.issues_indexes.map((id_and_index) => id_and_index[0]))
    ).length,
    clusterIndices: Array.from(
      new Set(cluster.issues_indexes.map((id_and_index) => id_and_index[0]))
    ),
  }));

  return (
    <div className="issue-pie-chart">
      <ResponsiveContainer height={400}>
        <PieChart width={400} height={400} className="pie-chart">
          <Pie
            data={data}
            cx="50%"
            cy="40%"
            labelLine={false}
            label={({ name, percent }) => {
              return `${truncate(name, 30)}: ${(percent * 100).toFixed(0)}%`;
            }}
            outerRadius={100}
            innerRadius={60}
            fontSize={14}
            fontWeight={600}
            fontFamily="NeueMontreal"
            fill="#8884d8"
            dataKey="value"
            animationDuration={100}
            isAnimationActive={false}
            onClick={(data, index) => {
              // get cluster indices from data and navigate to /t/?query=filter:cluster_name:id1,id2,id3
              const clusterIndices = Array.from(new Set(data.clusterIndices));
              // replace everything but [A-Za-z0-9_] with ''
              const name = data.name.replace(/[^A-Za-z0-9_ ]/g, "");
              const clusterFilter = `idfilter:${name}:${clusterIndices.join(
                ","
              )}`;
              // current address looks like: http://localhost/u/developer/abc/t/41
              // navigate to ?query=filter:cluster_name:id1,id2,id3
              navigate({
                search: `?query=${clusterFilter}`,
              });
              setTimeout(() => window.location.reload(), 10);
            }}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

function truncate(str, n) {
  return str.length > n ? str.substr(0, n - 1) + "..." : str;
}

import { BarChart, Bar, XAxis, YAxis } from "recharts";

type ToolData = {
  name: string;
  n: number;
  n_success: number;
};

type Tools = Record<string, ToolData>;

type Props = {
  tools: Tools;
  sort: "asc" | "desc";
};

export const ToolsBySuccessRateChart: React.FC<Props> = ({ tools, sort }) => {
  const data = Object.values(tools)
    .filter((t) => t.n > 0.5)
    .map((t) => ({
      name: t.name,
      failureRate: t.n > 1 ? (1 - t.n_success / t.n) * 100 : 0,
      n: t.n,
    }))
    .sort((a, b) =>
      sort === "desc"
        ? b.failureRate - a.failureRate
        : a.failureRate - b.failureRate
    );

  return (
    <ResponsiveContainer height={300}>
      <BarChart data={data}>
        <XAxis dataKey="name" />
        <YAxis />
        {/* also show n in tooltip */}
        <Tooltip
          formatter={(value: number, name, props) => {
            return [
              `${value.toFixed(2)}%`,
              `Failure Rate (${props.payload.n * (value / 100)}/${
                props.payload.n
              })`,
            ];
          }}
        />
        <Bar
          dataKey="failureRate"
          fill={sort === "desc" ? "#00C49F" : "#FF6666"}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

export const ToolsByUsageChart: React.FC<Props> = ({ tools }) => {
  const data = Object.values(tools)
    .map((t) => ({
      name: t.name,
      usage: t.n,
    }))
    .sort((a, b) => b.usage - a.usage);

  return (
    <ResponsiveContainer height={300}>
      <BarChart data={data}>
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="usage" fill="#0088FE" />
      </BarChart>
    </ResponsiveContainer>
  );
};
