# Explorer UI

## Annotations

Explorer supports different annotation types, allowing for the visualization of issues, guardrail failures and user annotations.

For annotations to be visualized correctly, they need to be in the correct format. The following sections describe the different annotation types and their formats.

### Guardrailing Errors

```
{
    "content": "Hello in user message",
    "address": "messages.0.content:0-5",
    "extra_metadata": {
        "source": "guardrails-error",
        "guardrail_content": "# this is a sample guardrail policy.\nraise \"Hello in user message\" if:\n   (msg: Message)\n   \"Hello\" in msg.content",
        "guardrail_action": "log"
    }
},
```

- `content` - The content of the message
- `address` - The address of the message in the conversation (can be character range (e.g. `:0-5`), line range (e.g. `:L2), object level (e.g. `messages.0.content) or a bounding box.
- `extra_metadata` - Extra metadata for the annotation:
    - `source` - The source of the annotation (always `guardrails-error`)
    - `guardrail_content` - The content of the guardrailing rule at evaluation time (optional)
    - `guardrail_action` - The action taken by the guardrail (e.g. `log`, `block`) (optional)


## User Annotations

```
{
    "content": "Hello in user message",
    "address": "messages.0.content:L2",
    "extra_metadata": null
}
```

- `content` - The content of the message
- `address` - The address of the message in the conversation. For user annotations, this is always a line range (e.g. `:L2`).
- `extra_metadata` - Extra metadata for the annotation (currently `null` for user annotations)


