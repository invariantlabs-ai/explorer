"""Utility functions for APIs."""

import base64
import copy
import hashlib
import io
import os
import re
import uuid
import aiofiles, asyncio
from typing import Optional

from fastapi import HTTPException
from PIL import Image

DATASET_NAME_REGEX = re.compile(r"^[a-zA-Z0-9-_]+$")


def validate_dataset_name(name: str):
    """Validate the dataset name."""
    if name is None:
        return
    if not DATASET_NAME_REGEX.match(name):
        raise HTTPException(
            status_code=400,
            detail="Dataset name can only contain A-Z, a-z, 0-9, - and _",
        )


def get_gravatar_hash(email):
    # see https://docs.gravatar.com/api/avatars/python/

    # Encode the email to lowercase and then to bytes
    email_encoded = email.lower().encode("utf-8")

    # Generate the SHA256 hash of the email
    email_hash = hashlib.sha256(email_encoded).hexdigest()

    return email_hash


def split(text, pattern):
    """
    Splits by pattern, but does not remove the pattern.

    Example:
    split("hello world", r"[\s]+") -> ["hello ", "world"]
    """

    def generator():
        nonlocal text
        while True:
            match = re.search(pattern, text)
            if match is None:
                break
            yield text[: match.end()]
            text = text[match.end() :]
        yield text

    result = [t for t in generator()]
    return result


def truncate_string(s, max_length: int):
    if not isinstance(s, str):
        return s
    k = len(s) - max_length
    if k <= 0:
        return s
    return (
        s[: max_length // 2]
        + f"<...truncated {k} characters...>"
        + s[-max_length // 2 :]
    )


def truncate_trace_content(messages: list[dict], max_length: Optional[int] = None):
    """
    Truncates all of the messages in the trace to max_length.
    """
    if max_length is None:
        return messages
    messages = copy.deepcopy(messages)
    for msg in messages:
        if msg.get("content", None) is not None:
            msg["content"] = truncate_string(msg["content"], max_length)
        if msg.get("tool_calls", None) is not None:
            for tool_call in msg["tool_calls"]:
                # only truncate tool calls that we know the structure of
                tool_call_function = tool_call.get("function", None)
                if not isinstance(tool_call_function, dict):
                    continue
                tool_call_arguments = tool_call_function.get("arguments", None)
                if not isinstance(tool_call_arguments, dict):
                    continue

                if isinstance(tool_call["function"]["arguments"], str):
                    # truncate the function name
                    tool_call["function"]["arguments"] = truncate_string(
                        tool_call["function"]["arguments"], max_length
                    )
                else:
                    # truncate the function name and all of the arguments
                    tool_call["function"]["arguments"] = {
                        truncate_string(name, max_length): truncate_string(
                            value, max_length
                        )
                        for name, value in tool_call["function"]["arguments"].items()
                    }
    return messages

async def parse_and_push_images(dataset, trace_id, messages):
    """
    Parse messages for base64 encoded images, save them to disk, and update message content with local file path.

    Args:
        dataset: Dataset name
        trace_id: UUID of the trace
        messages: List of messages to process

    Returns:
        Updated messages with image paths
    """
    async def parse_and_push_single_image(msg):
        if msg.get("role") != "tool" or type(msg.get("content")) != str:
            return
        if msg.get("content").startswith("base64_img: ") or msg.get(
            "content"
        ).startswith("local_base64_img: "):
            prefix = (
                "base64_img: "
                if msg.get("content").startswith("base64_img: ")
                else "local_base64_img: "
            )
            img_base64 = msg.get("content")[len(prefix) :]
            
            try:
                img_data = base64.b64decode(img_base64)
            except Exception as e:
                raise ValueError("Failed to decode base64 image") from e
            
            # Generate a unique filename for the image
            img_filename = f"{dataset}/{trace_id}/{uuid.uuid4()}.png"
            # Save the image as a temporary file
           
            img_path = f"/srv/images/{img_filename}"
            os.makedirs(os.path.dirname(img_path), exist_ok=True)
            try:
                async with aiofiles.open(img_path, "wb") as f:
                    await f.write(img_data)
            except Exception as e:
                print("exception: ", e)
                raise IOError("Failed to save image to disk") from e
            msg["content"] = "local_img_link: " + img_path

    save_images = [parse_and_push_single_image(msg) for msg in messages]
    await asyncio.gather(*save_images)

    return messages
