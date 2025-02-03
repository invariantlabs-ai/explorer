import { BsSpeedometer2 } from "react-icons/bs";
import Home from "./pages/Home/Home";
import Layout from "./Layout.tsx";
import { SingleTrace } from "./pages/Traces/Traces.tsx";
import "./App.scss";
import DatasetView from "./pages/Traces/Dataset.tsx";
import { New } from "./pages/NewTrace/New.tsx";
import { SignUp } from "./pages/SignUp/SignUp.tsx";
import User from "./pages/User/User.tsx";
import { Snippets } from "./pages/Snippet/Snippets.tsx";
import { Settings } from "./pages/Setting/Settings.tsx";
import MarkdownFile from "./MarkdownFile.tsx";

import privacyPolicy from "./assets/policy.md?raw";
import terms from "./assets/terms.md?raw";

export const routes = [
  {
    path: "/",
    label: "Home",
    icon: <BsSpeedometer2 />,
    element: (
      <Layout>
        <Home />
      </Layout>
    ),
    category: "home",
  },
  {
    path: "/u/:username",
    label: "User",
    element: (
      <Layout>
        <User />
      </Layout>
    ),
    loader: async (user: any) => {
      return { username: user.params.username };
    },
  },
  {
    path: "/u/:username/:datasetname",
    label: "Dataset",
    element: (
      <Layout>
        <DatasetView />
      </Layout>
    ),
    loader: async (task: any) => {
      return {
        datasetname: task.params.datasetname,
        username: task.params.username,
      };
    },
  },
  {
    path: "/u/:username/:datasetname/t/:traceIndex",
    label: "Dataset",
    element: (
      <Layout fullscreen withTabs>
        <DatasetView />
      </Layout>
    ),
    loader: async (task: any) => {
      return {
        datasetname: task.params.datasetname,
        username: task.params.username,
        traceIndex: parseInt(task.params.traceIndex) || 0,
      };
    },
  },
  {
    path: "/u/:username/:datasetname/t",
    label: "Dataset",
    element: (
      <Layout fullscreen>
        <DatasetView />
      </Layout>
    ),
    loader: async (task: any) => {
      return {
        datasetname: task.params.datasetname,
        username: task.params.username,
        traceId: null,
      };
    },
  },
  {
    path: "/trace/:traceId",
    label: "Dataset",
    element: (
      <Layout needsLogin={false} fullscreen>
        <SingleTrace />
      </Layout>
    ),
    loader: async (task: any) => {
      return {
        traceId: task.params.traceId,
      };
    },
  },
  {
    path: "/new",
    label: "Upload New Trace",
    element: (
      <Layout needsLogin fullscreen>
        <New />
      </Layout>
    ),
    loader: async (task: any) => {
      return {};
    },
  },
  {
    path: "/signup",
    label: "Sign Up",
    element: (
      <Layout needsLogin>
        <SignUp />
      </Layout>
    ),
  },
  // /snippets
  {
    path: "/snippets",
    label: "Snippets",
    element: (
      <Layout needsLogin>
        <Snippets />
      </Layout>
    ),
  },
  // /settings
  {
    path: "/settings",
    label: "Settings",
    element: (
      <Layout needsLogin>
        <Settings />
      </Layout>
    ),
  },
  {
    path: "/terms",
    label: "Terms & Conditions",
    element: (
      <Layout>
        <MarkdownFile contents={terms}></MarkdownFile>
      </Layout>
    ),
  },
  {
    path: "/policy",
    label: "Terms & Conditions",
    element: (
      <Layout>
        <MarkdownFile contents={privacyPolicy}></MarkdownFile>
      </Layout>
    ),
  },
  // 404
  {
    path: "*",
    label: "Not Found",
    element: (
      <Layout>
        <div className="empty">
          <h3>Not Found</h3>
        </div>
      </Layout>
    ),
    category: "hidden",
  },
];
