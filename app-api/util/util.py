import copy
import hashlib
import json
import re
from typing import Optional
 
def get_gravatar_hash(email):
    # see https://docs.gravatar.com/api/avatars/python/

    # Encode the email to lowercase and then to bytes
    email_encoded = email.lower().encode('utf-8')
     
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
            yield text[:match.end()]
            text = text[match.end():]
        yield text
    result = [t for t in generator()]
    return result

def truncate_string(s: str, max_length: int):
    k = len(s) - max_length
    if k <= 0:
        return s
    return s[:max_length//2] + f"<...truncated {k} characters...>" + s[-max_length//2:]


def truncate_trace_content(messages: list[dict], max_length: Optional[int] = None):
    """
    Truncates all of the messages in the trace to max_length.
    """
    if max_length is None:
        return messages
    messages = copy.deepcopy(messages)
    for msg in messages:
        if "content" in msg:
            msg["content"] = truncate_string(msg["content"], max_length)
        if "tool_calls" in msg:
            for tool_call in msg["tool_calls"]:
                if "function" in tool_call and "arguments" in tool_call["function"]:
                    tool_call["function"]["arguments"] = {
                        truncate_string(name, max_length): truncate_string(value, max_length)
                        for name, value in tool_call["function"]["arguments"].items()
                    }
    return messages

