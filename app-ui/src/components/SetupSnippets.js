/**
 * A collection of code snippets for setting up the Invariant SDK or Gateway for uploading
 * traces to the explorer.
 *
 * Needs to be updated if the API changes or new integrations are added.
 */

export const SETUP_SNIPPETS = [
  {
    name: "OpenAI",
    description: "Upload via Gateway and the OpenAI Python SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/llm-provider-integrations/openai/",
    snippetPerLanguage: {
      python: (dataset, instance) => `from openai import OpenAI
import os

openai_client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url="${instance}/api/v1/gateway/${dataset}/openai",
    default_headers={"Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY")},
)`,
      typescript: (dataset, instance) => `import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
  baseURL: "${instance}/api/v1/gateway/${dataset}/openai",
  defaultHeaders: {"Invariant-Authorization": "Bearer " + process.env['INVARIANT_API_KEY'],},
});`
},
},
  {
    name: "MCP",
    description:
      "Use Invariant via its MCP Gateway, to guardrail and log your MCP server interactions.",
    link: "https://explorer.invariantlabs.ai/docs/",
    snippetPerLanguage: {json: (dataset, instance) => `{
 "you-mcp-server": {
  "command": "uvx",
  "args": [
    "invariant-gateway@latest",
    "mcp",
    "--project-name",
    "${dataset}",
    "--push-explorer",
    "--exec",
    "...(your MCP server command with npx or uvx)...",
  ],
  "env": {
    "INVARIANT_API_KEY": "<INVARIANT_API_KEY>",${!instance.includes("https://explorer.invariantlabs.ai") ? '\n    "INVARIANT_API_ENDPOINT": "' + instance + '",' : ""}
  }
}
`},
  },
  {
    name: "Anthropic",
    description: "Upload via Gateway and the Anthropic Python SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/llm-provider-integrations/anthropic/",
    snippetPerLanguage: {python: (dataset, instance) => `from anthropic import Anthropic
import os

anthropic_client = Anthropic(
    api_key=os.getenv("ANTHROPIC_API_KEY"),
    default_headers={"Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY")},
    base_url="${instance}/api/v1/gateway/${dataset}/anthropic",
)`,
      typescript: (dataset, instance) => `import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"],
  baseURL: "${instance}/api/v1/gateway/${dataset}/anthropic",
  defaultHeaders: {"Invariant-Authorization": "Bearer " + process.env['INVARIANT_API_KEY'],},
});`,
}},
  {
    name: "Gemini",
    description: "Upload via Gateway and the Gemini Python SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/llm-provider-integrations/gemini/",
    snippetPerLanguage: {python: (dataset, instance) => `from google import genai
import os

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"],
    http_options={
        "base_url": "${instance}/api/v1/gateway/${dataset}/gemini",
        "headers": {
            "Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY"),
        },
    },
)`,
      typescript: (dataset, instance) => `import {GoogleGenAI} from '@google/genai';

const gemini = new GoogleGenAI({
    apiKey: process.env['GEMINI_API_KEY'],
    httpOptions: {
        baseUrl: '${instance}/api/v1/gateway/${dataset}/gemini',
        headers: {
            'Invariant-Authorization': "Bearer " + process.env['INVARIANT_API_KEY'],
        },
    }
});`
  }},
  {
    name: "Agents SDK",
    description: "Upload via Gateway and the OpenAI Agents SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/agent-integrations/openai-agents-sdk/",
    snippetPerLanguage: {
      python: (
        dataset,
        instance
      ) => `from agents import Agent, OpenAIChatCompletionsModel
from openai import AsyncOpenAI
import os

external_client = AsyncOpenAI(
    base_url="${instance}/api/v1/gateway/${dataset}/openai",
    default_headers={
        "Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY"),
    },
)

agent = Agent(
    name="Assistant", instructions="You are a helpful assistant",
    model=OpenAIChatCompletionsModel(model="gpt-4o", openai_client=external_client),
)`}
  },
  {
    name: "Swarm",
    description: "Upload via Gateway from within the Swarm framework.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/agent-integrations/openai-swarm/",
    snippetPerLanguage: {python: (dataset, instance) => `from swarm import Swarm, Agent
from openai import OpenAI
from httpx import Client
import os

client = Swarm(
  client=OpenAI(
    base_url="${instance}/api/v1/gateway/${dataset}/openai",
    default_headers={"Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY")},
  )
)`,}
  },
  {
    name: "Invariant SDK",
    description: "Use the Invariant SDK to manually upload traces.",
    link: "https://explorer.invariantlabs.ai/docs/explorer/api/uploading-traces/push-api/",
    snippetPerLanguage: {python: (dataset, instance) => `from invariant_sdk.client import Client

# requires the 'INVARIANT_API_KEY' environment variable to be set
client = Client()

messages = [
    [
        {"role": "user", "content": "Hello world"},
        {"role": "assistant", "content": "Hello! How can I help you?"},
    ]
]

response = client.create_request_and_push_trace(messages=messages, dataset="${dataset}")`,}
  },
  {
    name: "JSON Upload",
    description: "Upload a JSONL file with traces.",
    snippetPerLanguage: {json: "<jsonl-upload>"},
  },
];
