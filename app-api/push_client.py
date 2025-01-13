import os

import requests


def push_trace(messages, annotations=None, dataset=None, metadata=None):
    api_token = os.getenv("INVARIANT_API_KEY")
    if not api_token:
        raise ValueError("INVARIANT_API_KEY not set")

    is_batched = (
        type(messages) is list and len(messages) > 0 and type(messages[0]) is list
    )

    payload = {
        "messages": messages if is_batched else [messages],
        "annotations": annotations if is_batched else [annotations],
        "dataset": dataset,
        "metadata": metadata if is_batched else [metadata],
    }

    # curl https://localhost/api/v1/keys/test -H "Authorization: Bearer <API>"
    r = requests.post(
        "https://localhost/api/v1/push/trace",
        json=payload,
        headers={"Authorization": "Bearer " + api_token},
        verify=False,
    )

    if r.status_code == 401:
        raise ValueError(
            "Invalid API token. Please make sure your INVARIANT_API_KEY is set correctly, has not expired and is connected to the correct account."
        )
    elif r.status_code == 404:
        raise ValueError("Could not find specified resource: ", r.json())
    elif r.status_code != 200:
        raise ValueError("Failed to push trace")

    return r.json()


if __name__ == "__main__":
    result = push_trace(
        [{"role": "user", "content": "Hello API"}],
        dataset="SWEAgent_20240705_111156",
        metadata={"source": "my agent application", "success": True},
    )

    assert "id" in result, "Expected id on successful push"

    # bached push
    result = push_trace(
        [
            [{"role": "user", "content": "Hello Batch API"}],
            [{"role": "user", "content": "Hello Batch API"}],
        ],
        dataset="SWEAgent_20240705_111156",
        metadata=[{"source": "my agent application", "success": True}, {}],
    )

    assert "id" in result, "Expected id on successful push"
    assert type(result["id"]) == list, "Expected list of ids on successful push"
    assert len(result["id"]) == 2, "Expected list of ids on successful push"

    # push without metadata
    result = push_trace(
        [{"role": "user", "content": "Hello API without metadata"}],
        dataset="SWEAgent_20240705_111156",
    )
    assert "id" in result, "Expected id on successful push"

    # push without metadata and dataset
    result = push_trace(
        [{"role": "user", "content": "Hello API without metadata and dataset"}]
    )
    assert "id" in result, "Expected id on successful push"

    result = push_trace(
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "0",
                        "type": "function",
                        "function": {
                            "name": "create",
                            "arguments": {"arg": "reproduce_issue.py\n"},
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "0",
                "content": "[File: /sympy__sympy/reproduce_issue.py (1 lines total)]\n1:\n",
            },
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "1",
                        "type": "function",
                        "function": {
                            "name": "edit",
                            "arguments": {
                                "code": '\nfrom sympy import Array, Matrix, __version__\n\nprint("SymPy version:", __version__)\nprint("Attempting to create an empty Matrix:")\nempty_matrix = Matrix([])\nprint("Empty Matrix created successfully:", empty_matrix)\n\nprint("Attempting to create an empty Array:")\ntry:\n    empty_array = Array([])\n    print("Empty Array created successfully:", empty_array)\nexcept Exception as e:\n    print("Failed to create an empty Array:", e)\n\nprint("Script completed successfully, no errors.")\n',
                                "loc": "1:1",
                            },
                        },
                    }
                ],
            },
        ],
        dataset=None,
        metadata={"source": "my agent application", "success": True},
        annotations=[
            {"content": "example annotation", "address": "messages.1.content:5-10"},
            {
                "content": "example annotation",
                "address": "messages.2.tool_calls.0.function.arguments.code:12-19",
            },
        ],
    )
    print(result)
    print("https://localhost/trace/{}".format(result["id"][0]))
