# Invariant Explorer Documentation

## Uploading Trace Datasets

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