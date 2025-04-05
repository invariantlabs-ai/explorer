/**
 * A collection of code snippets for setting up the Invariant SDK or Gateway for uploading
 * traces to the explorer.
 *
 * Needs to be updated if the API changes or new integrations are added.
 */

export const SETUP_SNIPPETS = [
  {
    name: "Chat",
    description: "Start by directly chatting to a simulated agent.",
    snippet: "<chat>",
  },
  {
    name: "OpenAI",
    description: "Upload via Gateway and the OpenAI Python SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/llm-provider-integrations/openai/",
    snippet: (dataset, instance) => `from openai import OpenAI
from httpx import Client
import os

http_client = Client(
  headers={
      "Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY"),
  },
)
openai_client = OpenAI(
  http_client=http_client,
  base_url="${instance}/api/v1/gateway/${dataset}/openai",
)`,
  },
  {
    name: "Anthropic",
    description: "Upload via Gateway and the Anthropic Python SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/llm-provider-integrations/anthropic/",
    snippet: (dataset, instance) => `from anthropic import Anthropic
from httpx import Client
import os

http_client = Client(
  headers={
    "Invariant-Authorization": "Bearer "  + os.getenv("INVARIANT_API_KEY"),
  },
)
anthropic_client = Anthropic(
  http_client=http_client,
  base_url="${instance}/api/v1/gateway/${dataset}/anthropic",
)`,
  },
  {
    name: "Gemini",
    description: "Upload via Gateway and the Gemini Python SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/llm-provider-integrations/gemini/",
    snippet: (dataset, instance) => `from google import genai
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
  },
  {
    name: "Agents SDK",
    description: "Upload via Gateway and the OpenAI Agents SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/agent-integrations/openai-agents-sdk/",
    snippet: (
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
)`,
  },
  {
    name: "Swarm",
    description: "Upload via Gateway from within the Swarm framework.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/agent-integrations/openai-swarm/",
    snippet: (dataset, instance) => `from swarm import Swarm, Agent
from openai import OpenAI
from httpx import Client
import os

client = Swarm(
  client=OpenAI(
      http_client=Client(headers={"Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY", "")}),
      base_url="${instance}/api/v1/gateway/${dataset}/openai",
  )
)`,
  },
  {
    name: "Invariant SDK",
    description: "Use the Invariant SDK to manually upload traces.",
    link: "https://explorer.invariantlabs.ai/docs/explorer/api/uploading-traces/push-api/",
    snippet: (dataset, instance) => `from invariant_sdk.client import Client

# requires the 'INVARIANT_API_KEY' environment variable to be set
client = Client()

messages = [
    [
        {"role": "user", "content": "Hello world"},
        {"role": "assistant", "content": "Hello! How can I help you?"},
    ]
]

response = client.create_request_and_push_trace(messages=messages, dataset="${dataset}")`,
  },
  {
    name: "JSON Upload",
    description: "Upload a JSONL file with traces.",
    snippet: "<jsonl-upload>",
  },
];
