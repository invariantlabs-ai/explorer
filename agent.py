from agents import Agent, OpenAIChatCompletionsModel, Runner, function_tool
from openai import AsyncOpenAI
import os

external_client = AsyncOpenAI(
    base_url="http://localhost/api/v1/gateway/new-agent/openai",
    default_headers={
        "Invariant-Authorization": "Bearer " + os.getenv("INVARIANT_API_KEY"),
    },
)


@function_tool
async def fetch_weather(location: str) -> str:
    return "sunny"


agent = Agent(
    name="Assistant",
    instructions="You are a helpful assistant",
    model=OpenAIChatCompletionsModel(
        model="gpt-4o",
        openai_client=external_client,
    ),
    tools=[fetch_weather],
)

result = Runner.run_sync(
    agent,
    "What is the weather like in Paris?",
)
print(result.final_output)
