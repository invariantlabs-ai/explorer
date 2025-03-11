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
    snippet: (dataset) => `from openai import OpenAI
from httpx import Client
import os

http_client = Client(
  headers={
      "Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY"),
  },
)
openai_client = OpenAI(
  http_client=http_client,
  base_url="https://explorer.invariantlabs.ai/api/v1/gateway/${dataset}/openai",
)`,
  },
  {
    name: "Anthropic",
    description: "Upload via Gateway and the Anthropic Python SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/llm-provider-integrations/anthropic/",
    snippet: (dataset) => `from anthropic import Anthropic
from httpx import Client
import os

http_client = Client(
  headers={
    "Invariant-Authorization": "Bearer "  + os.getenv("INVARIANT_API_KEY"),
  },
)
anthropic_client = Anthropic(
  http_client=http_client,
  base_url="https://explorer.invariantlabs.ai/api/v1/gateway/${dataset}/anthropic",
)`,
  },
  {
    name: "Gemini",
    description: "Upload via Gateway and the Gemini Python SDK.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/llm-provider-integrations/gemini/",
    snippet: (dataset) => `from google import genai
import os

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"],
    http_options={
        "base_url": "https://explorer.invariantlabs.ai/api/v1/gateway/${dataset}/gemini",
        "headers": {
            "Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY"),
        },
    },
)`,
  },
  {
    name: "Swarm",
    description: "Upload via Gateway from within the Swarm framework.",
    link: "https://explorer.invariantlabs.ai/docs/gateway/agent-integrations/openai-swarm/",
    snippet: (dataset) => `from swarm import Swarm, Agent
from openai import OpenAI
from httpx import Client
import os

client = Swarm(
  client=OpenAI(
      http_client=Client(headers={"Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY", "")}),
      base_url="https://explorer.invariantlabs.ai/api/v1/gateway/${dataset}/openai",
  )
)`,
  },
  {
    name: "SDK",
    description: "Use the Invariant SDK to manually upload traces.",
    link: "https://explorer.invariantlabs.ai/docs/explorer/api/uploading-traces/push-api/",
    snippet: (dataset) => `from invariant_sdk.client import Client

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
