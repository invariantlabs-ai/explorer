# Invariant Explorer Documentation

## Uploading Trace Datasets (`.jsonl`)

### Metadata

Explorer supports two levels of trace metadata: (1) dataset metadata and (2) trace metadata.

#### Dataset Metadata

To provide dataset metadata, simply include a metadata JSON object as the first line of your uploaded `.jsonl` file, with the following fields:

```
{"metadata": {...}}
```

This metadata object will not be included as a separate trace and will not be displayed in the trace list. It is only used to provide additional information about the dataset.

#### Trace Metadata

To provide trace metadata, include a metadata JSON object as the first message of a trace, similar to the dataset metadata:

```
{"metadata": {...}}
```

Again, this metadata object will not be included as trace event, but rather as metadata for the entire trace.

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
annotations: null (required)
```

**Description**: Currently not supported, should always be null.

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
  "annotations": null,
  "dataset": "example_dataset",
  "metadata": [{"metadata_key1": "metadata_key1 for trace 1"}, {"metadata_key2": "metadata_key2 for trace 2"}]
}
```