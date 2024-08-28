/**
 * Utilities for opening a trace in the Invariant Playground.
 */


function findSomeToolCallName(messages) {
    let tool_call_msg = messages.find(msg => msg.tool_calls)
    if (!tool_call_msg) return null

    let tool_call = tool_call_msg.tool_calls.find(tc => tc.function.name)
    if (!tool_call) return null

    return tool_call.function.name
}

function makeCompatibleInvariantPolicy(messages) {
    let tool_call = findSomeToolCallName(messages)
    if (tool_call) {
        return "(call: ToolCall)\n    call is tool:" + tool_call
    } else {
        // find some random message with text content and create policy to match some word
        let message = messages.find(msg => msg.content)
        if (!message) return null;
        let content = message.content
        let word = content.split(' ')[0]
        let msg_type = message.role == 'tool' ? ['out', 'ToolOutput'] : ['msg', 'Message']
        return `(${msg_type[0]}: ${msg_type[1]})\n    "${word}" in ${msg_type[0]}.content`
    }
}

export function openInPlayground(messages) {
  if (!messages) {
    alert('Failed to send to Invariant: No messages');
    return;
  }

  try {
    // translate tool_call_ids and ids to strings if needed (analyzer expects strings)
    messages = messages.map(message => {
      message = JSON.parse(JSON.stringify(message))
      if (typeof message.tool_call_id !== 'undefined') {
        message.tool_call_id = message.tool_call_id.toString()
      }
      (message.tool_calls || []).forEach(tool_call => {
        if (typeof tool_call.id !== 'undefined') {
          tool_call.id = tool_call.id.toString()
        }
      })
      return message
    })
    
    const object = {
      "policy": `raise "Detected issue" if:
    # specify your conditions here
    # To learn more about Invariant policies go to https://github.com/invariantlabs-ai/invariant
    
    # example query
    ${makeCompatibleInvariantPolicy(messages) || 'True'}`,
      "input": JSON.stringify(messages || [])
    }
    // JSON encode and send to playground
    const json_object = JSON.stringify(object)  
    // base64 encode
    const b64_object = btoa(json_object)
    // open in new tab
    window.open(`https://playground.invariantlabs.ai/#${b64_object}`, '_blank')
  } catch (e) {
    alert('Failed to send to Invariant: ' + e)
  }
}
