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

const IssuePieChart = (props) => {
  const navigate = useNavigate();

  const rawData = props.data;

  if (!rawData) {
    return null;
  }

  const data = rawData.map((cluster, index) => ({
    name: cluster.name,
    value: Array.from(
      new Set(cluster.issues.map((issue) => issue.metadata?.index))
    ).length,
    clusterIndices: Array.from(
      new Set(cluster.issues.map((issue) => issue.metadata?.index))
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
              const clusterFilter = `filter:${name}:${clusterIndices.join(
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

export default IssuePieChart;
