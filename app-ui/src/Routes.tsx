import { BsSpeedometer2 } from "react-icons/bs";
import Home from "./pages/home/Home.tsx";
import Layout from "./layouts/Layout.tsx";
import { SingleTrace } from "./pages/traces/Traces.tsx";
import "./styles/App.scss";
import DatasetView from "./pages/traces/Dataset.tsx";
import { NewTrace } from "./pages/new-trace/NewTrace.tsx";
import { SignUp } from "./pages/signup/SignUp.tsx";
import User from "./pages/user/User.tsx";
import { Snippets } from "./pages/snippets/Snippets.tsx";
import { Settings } from "./pages/setting/Settings.tsx";
import MarkdownFile from "./components/MarkdownFile.tsx";

import privacyPolicy from "./assets/policy.md?raw";
import terms from "./assets/terms.md?raw";
import { DeployGuardrail } from "./pages/deploy-guardrail/DeployGuardrail.tsx";

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
      <Layout fullscreen withTabs>
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
      <Layout fullscreen withTabs>
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
        <NewTrace />
      </Layout>
    ),
    loader: async (task: any) => {
      return {};
    },
  },
  {
    path: "/deploy-guardrail",
    label: "Deploy A Guardrailing Rule",
    element: (
      <Layout needsLogin fullscreen>
        <DeployGuardrail />
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
