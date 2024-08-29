import requests
import os
import json

def push_trace(messages, annotations=None, dataset_id=None, metadata=None):
    api_token = os.getenv('INVARIANT_API_TOKEN')
    if not api_token:
        raise ValueError('INVARIANT_API_TOKEN not set')

    # curl https://localhost/api/v1/keys/test -H "Authorization: Bearer <API>"
    r = requests.post('https://localhost/api/v1/push/trace', json={
        "messages": messages,
        "annotations": annotations,
        "dataset_id": dataset_id,
        "metadata": json.dumps(metadata)
    }, headers={
        "Authorization": "Bearer " + api_token
    }, verify=False)

    if r.status_code == 401:
        raise ValueError('Invalid API token. Please make sure your INVARIANT_API_TOKEN is set correctly and has not expired.')
    elif r.status_code != 200:
        raise ValueError('Failed to push trace')
    
    return r.json()

if __name__ == '__main__':
    print('hi')
    print(push_trace([
        {
            "role": "user",
            "content": "Hello API"
        }
    ], metadata={
        "source": "my agent application",
        "success": True
    }))