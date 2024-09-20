# Invariant Explorer Documentation

## Uploading Trace Datasets (`.jsonl`)

### Trace Format

The explorer supports two types of trace formats. (1) raw event lists and (2) annotated event lists. 

#### Raw Event Lists

Raw event lists are just `jsonl` files where each line is a JSON array of events. Each event is a dictionary with at least a `role` and `content` field. 

```json
[{ "role": "user", "content": "Hello, world!" }, { "role": "assistant", "content": "Hi!" }]
[{ "role": "user", "content": "How are you?" }, { "role": "assistant", "content": "I'm good, thanks!" }]
...
```

To include trace-level metadata in raw event lists, include a metadata JSON object as the first event in a line. 

```json
[{"metadata": {"key": "value"}}, { "role": "user", "content": "Hello, world!" }, { "role": "assistant", "content": "Hi!" }]
```

#### Annotated Event Lists

Annotated event lists support the same format as raw event lists, but also include annotations. For this, each row is a JSON object with the fields `messages`, `annotations` (optional) and `metadata` (optional).

```json
{"messages": [{ "role": "user", "content": "Hello, world!" }, { "role": "assistant", "content": "Hi!" }], "annotations": [{"content": "example annotation", "address": "messages.0.content:5-10"}], "metadata": {"key": "value"}}
{"messages": [{ "role": "user", "content": "How are you?" }, { "role": "assistant", "content": "I'm good, thanks!" }], "annotations": [], "metadata": {}}
```

### Dataset Metadata

To provide dataset metadata, simply include a metadata JSON object as the first line of your uploaded `.jsonl` file, with the following fields:

```json
{"metadata": {...}}
```

This is supported for both raw and annotated event lists.

## Push Trace API (`/api/v1/push/trace`)

### `POST /api/v1/push/trace`

**Description**
This endpoint allows you to push new trace data to Explorer. The trace data must include messages, and can optionally include dataset information and metadata. Annotations are not supported yet. 

Specify `dataset` if you want to add the trace to one of your datasets. If you don't specify a dataset, the trace will be uploaded as a private snippet on your account.

#### Headers
**Authorization:** `Bearer <INVARIANT_API_TOKEN>`

**Required**: Yes

**Description**: Bearer token for authenticating API requests. Ensure the environment variable INVARIANT_API_TOKEN is set correctly.

#### Request Body

The body should be in JSON format and contain the following keys:

```typescript
messages: list[list[dict]] (required)
```

**Description:** A list of batched traces to push. Each element is itself a list of event.

```typescript
annotations: list[list[dict]]
```

**Description**: A list of annotations per trace in messages. Each annotation is an object of shape `{"content": "...", "address": "..."}` where the address is of the form `messages.0.content:5-10`, i.e. a pair `<json_path>:<start>-<end>` that is resolved relative to the relevant trace in `messages`. For instance, `messages.0.content:5-10` will annotate the the character range 5-10 in the `content` value of the first message of the event log.

```typescript
dataset: string (optional)
```

**Description**: Name of the dataset to which the trace should be appended. If not provided, the trace will be uploaded as a private snippet on your account.

```typescript
metadata: list[dict] (optional)
```

**Description:** A list of metadata dictionaries corresponding to each batch of messages. If not provided, it will be null by default.

**Example Request**

This example shows how to push two traces with metadata to the dataset `example_dataset`.

```bash
curl -X POST https://explorer.invariantlabs.ai/api/v1/push/trace \
-H "Authorization: Bearer YOUR_API_TOKEN" \
-H "Content-Type: application/json" \
-d '{
  "messages": [[{"role": "user", "content": "first message in trace 1"}], [{"role": "user", "content": "first message in trace 2"}]],
  "annotations": [[{"content": "example annotation", "address": "messages.0.content:5-10"}]]
  "dataset": "example_dataset",
  "metadata": [{"metadata_key1": "metadata_key1 for trace 1"}, {"metadata_key2": "metadata_key2 for trace 2"}]
}
```
