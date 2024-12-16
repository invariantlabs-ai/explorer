import json
import base64

# Open and convert the image to base64
with open("inv_labs_screen.png", "rb") as image_file:
    encoded_string = base64.b64encode(image_file.read()).decode('utf-8')

trace_1 = {"messages":[
  {
    "role": "user",
    "content": "What's the weather like in Zurich today?"
  },
  {
    "role": "assistant",
    "content": "Let me check the current weather in Zurich for you.",
    "tool_calls": [
      {
        "type": "function",
        "id": "call_1",
        "function": {
          "name": "get_current_weather",
          "arguments": {
            "location": "Zurich"
          }
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "call_1",
    "content": "{\"temperature\": \"8°C\", \"condition\": \"cloudy\", \"humidity\": \"70%\", \"wind_speed\": \"15 km/h\"}"
  },
  {
    "role": "assistant",
    "content": "The current weather in Zurich is 8°C with cloudy skies. The humidity is 70%, and the wind speed is 15 km/h."
  }
]}

trace_2 = {
    "messages": [
  {
    "role": "user",
    "content": "For the first person who won 2 Nobel Prizes in different categories, please let me know their name, where they were born, and what year."
  },
  {
    "role": "assistant",
    "content": "Let me find the first person who won 2 Nobel Prizes in different categories.",
    "tool_calls": [
      {
        "type": "function",
        "id": "call_1",
        "function": {
          "name": "get_nobel_prize_winner_by_criteria",
          "arguments": "{\"category\": \"different\", \"count\": 2}"
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "call_1",
    "content": "{\"name\": \"Marie Curie\", \"categories\": [\"Physics\", \"Chemistry\"]}"
  },
  {
    "role": "assistant",
    "content": "The first person who won 2 Nobel Prizes in different categories is Marie Curie. Now, let me find where she was born.",
    "tool_calls": [
      {
        "type": "function",
        "id": "call_2",
        "function": {
          "name": "get_birthplace_of_person",
          "arguments": "{\"name\": \"Marie Curie\"}"
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "call_2",
    "content": "\"Warsaw, Poland\""
  },
  {
    "role": "assistant",
    "content": "Marie Curie was born in Warsaw, Poland. Now, let me find the years in which she won the Nobel Prizes.",
    "tool_calls": [
      {
        "type": "function",
        "id": "call_3",
        "function": {
          "name": "get_year_of_nobel_prizes",
          "arguments": "{\"name\": \"Marie Curie\"}"
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "call_3",
    "content": "[1903, 1911]"
  },
  {
    "role": "assistant",
    "content": "Marie Curie, the first person to win 2 Nobel Prizes in different categories, was born in Warsaw, Poland. She won the Nobel Prize in 1903 (Physics) and 1911 (Chemistry)."
  }
],
"annotations": [
        {
            "id": "6fbd7e0f-0618-4aab-96a7-4f6a2754a508",
            "trace_id": "b4bd6418-b7da-44d3-937a-b0af6128b6e6",
            "content": "wow, very cool. This is an annotation example. Welcome to Invariant Explorer.",
            "address": "messages[2].content:L0",
            "time_created": "2024-12-13T12:31:09.119005+00:00",
        }
    ]
}

trace_3 = {
    "messages": [
        {"role": "user", "content": "What is the mission of Invariant Labs?"},
        {"role": "assistant", "content": "Let me visit their website to find out.", "tool_calls": [{"type": "function", "function": {"name": "visit_website", "arguments": {"url": "https://invariantlabs.ai"}}}]},
        {"role": "assistant", "content": "I will read the content of the website by taking a screenshot.", "tool_calls": [{"type": "function", "function": {"name": "screenshot", "arguments": {}}}]},
        {"role": "tool", "content": f"local_base64_img: {encoded_string}"},
        {"role": "assistant", "content": "The mission of Invariant Labs is to make AI agents work.", "tool_calls": []}
    ]
}

traces = [trace_1, trace_2, trace_3]

with open("sample_data.jsonl", "w") as f:
    for trace in traces:
        f.write(json.dumps(trace) + "\n")
