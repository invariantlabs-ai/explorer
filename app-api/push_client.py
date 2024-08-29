import requests
import os
import json

def push_trace(messages, annotations=None, dataset=None, metadata=None):
    api_token = os.getenv('INVARIANT_API_KEY')
    if not api_token:
        raise ValueError('INVARIANT_API_KEY not set')

    if annotations is not None:
        raise ValueError('annotations are not supported yet')

    is_batched = type(messages) is list and len(messages) > 0 and type(messages[0]) is list

    payload = {
        "messages": messages if is_batched else [messages],
        "annotations": annotations,
        "dataset": dataset,
        "metadata": metadata if is_batched else [metadata]
    }

    print(payload['messages'])

    # curl https://localhost/api/v1/keys/test -H "Authorization: Bearer <API>"
    r = requests.post('https://localhost/api/v1/push/trace', json=payload, headers={"Authorization": "Bearer " + api_token}, verify=False)

    if r.status_code == 401:
        raise ValueError('Invalid API token. Please make sure your INVARIANT_API_KEY is set correctly, has not expired and is connected to the correct account.')
    elif r.status_code == 404:
        raise ValueError('Could not find specified resource: ', r.json())
    elif r.status_code != 200:
        raise ValueError('Failed to push trace')
    
    return r.json()

"""
Based on this an API endpoint documentation in Markdown format:
"""

if __name__ == '__main__':
    result = push_trace([
        {
            "role": "user",
            "content": "Hello API"
        }
    ], dataset="SWEAgent_20240705_111156", metadata={
        "source": "my agent application",
        "success": True
    })

    assert "id" in result, "Expected id on successful push"

    # bached push
    result = push_trace([[
        {
            "role": "user",
            "content": "Hello Batch API"
        }
    ],
    [
        {
            "role": "user",
            "content": "Hello Batch API"
        }
    ]], dataset="SWEAgent_20240705_111156", metadata=[{
        "source": "my agent application",
        "success": True
    }, {}])

    assert "id" in result, "Expected id on successful push"
    assert type(result['id']) == list, "Expected list of ids on successful push"
    assert len(result['id']) == 2, "Expected list of ids on successful push"

    # push without metadata
    result = push_trace([
        {
            "role": "user",
            "content": "Hello API without metadata"
        }
    ], dataset="SWEAgent_20240705_111156")
    assert "id" in result, "Expected id on successful push"

    # push without metadata and dataset
    result = push_trace([
        {
            "role": "user",
            "content": "Hello API without metadata and dataset"
        }
    ])
    assert "id" in result, "Expected id on successful push"