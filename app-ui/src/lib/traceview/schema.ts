/** Validates a trace for Invarant compatibility using a JSON schema. */
import Ajv from "ajv";

const tool_call_schema = {
  type: "object",
  properties: {
    id: { type: ["string", "number"] }, 
    type: { type: "string", enum: ["function"] },
    function: {
      type: "object",
      properties: {
        name: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["name", "arguments"],
    },
  },
  required: ["id", "type", "function"],
};


const image_chunk_schema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["image_url"] },
    image_url: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  required: ["type", "image_url"],
};

const text_chunk_schema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["text"] },
    text: { type: "string" },
  },
  required: ["type", "text"],
};


const content_schema = {
  type: "object",
  oneOf: [image_chunk_schema, text_chunk_schema],
};


const event_schema = {
  type: "object",
  // schema for regular messages
  properties: {
    role: { type: "string" },
    // content can be string or null
    content: { type: ["string", "null", "array"], items: content_schema },
    tool_call_id: { type: ["string", "number", "null"] },
    tool_calls: {
      type: "array",
      items: tool_call_schema,
    },
  },
  required: ["role", "content"],
};

const ajv = new Ajv();

export function validate_event(
  event: any,
): { instancePath: string; message: string }[] {
  // non strict
  const event_validate = ajv.compile(event_schema);
  const tool_call_validate = ajv.compile(tool_call_schema);

  // first try as a message
  const is_message = event_validate(event);
  if (is_message) return [];

  // fallback to tool call
  const is_tool_call = tool_call_validate(event);
  if (is_tool_call) return [];

  // otherwise, decide which errors to prioritize
  if (event["type"]) {
    // if it looks like a tool call, prioritize tool call errors
    return (tool_call_validate.errors || []).map((error: any) => ({
      instancePath: error.instancePath,
      message: error.message,
    }));
  } else {
    // otherwise, prioritize message errors
    return (event_validate.errors || []).map((error: any) => ({
      instancePath: error.instancePath,
      message: error.message,
    }));
  }
}

export function validate(trace: any): { valid: boolean; errors: any[] } {
  if (!Array.isArray(trace)) {
    return {
      valid: false,
      errors: [{ instancePath: "/", message: "Trace must be an array" }],
    };
  } else {
    let errors = trace.flatMap((event: any, index: number) => {
      let event_errors = validate_event(event);
      event_errors = event_errors.map((error: any) => {
        error.instancePath = `/${index}${error.instancePath}`;
        return error;
      });
      return event_errors;
    });

    let valid = errors.length === 0;
    return { valid, errors };
  }
}

export function format_error(error: any): string {
  return `${error.instancePath} ${error.message}`;
}
