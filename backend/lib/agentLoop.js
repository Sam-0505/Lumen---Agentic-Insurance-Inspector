/**
 * Generic tool-calling agent loop against TAMUS AI's OpenAI-compatible
 * chat completions endpoint.
 *
 * The model decides which tools to call, how many, and in what order —
 * this function only executes what it asks for and feeds results back,
 * until it returns a final answer with no more tool calls (or the
 * iteration cap forces one). Nothing here decides *what* to investigate;
 * that decision belongs to the model, which is what makes this an agent
 * loop rather than a fixed pipeline with a retrieval step bolted on.
 *
 * Proxy quirk (found by direct probing against this endpoint): replaying
 * an assistant tool-call message requires an explicit string `content`
 * field. The API's own response omits `content` when a message is
 * tool-calls-only, but replaying it back with `content: null` or without
 * the key at all gets a 400 from this proxy's stricter schema. `content: ''`
 * satisfies both the OpenAI message shape and this proxy.
 */

const { createChatCompletion } = require('./tamusChat');

const DEFAULT_MAX_ITERATIONS = 6;

async function runAgentLoop({ systemPrompt, userMessage, tools, executeTool, maxIterations = DEFAULT_MAX_ITERATIONS }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  const toolTrace = [];

  for (let i = 0; i < maxIterations; i++) {
    // On the last allowed iteration, drop tools so the model is forced to
    // answer with what it has rather than requesting yet another round.
    const isLastIteration = i === maxIterations - 1;

    const data = await createChatCompletion({
      messages,
      tools: isLastIteration ? undefined : tools,
      tool_choice: isLastIteration ? undefined : 'auto',
    });

    const message = data?.choices?.[0]?.message;
    if (!message) {
      throw new Error(`Unexpected TAMUS AI response format: ${JSON.stringify(data).slice(0, 300)}`);
    }

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { finalMessage: message.content, toolTrace, iterations: i + 1 };
    }

    messages.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // Malformed arguments from the model — fed back as a tool error
        // rather than crashing the loop, so the model can retry or move on.
      }

      let result;
      try {
        result = await executeTool(call.function.name, args);
      } catch (err) {
        result = { error: err.message };
      }

      toolTrace.push({ tool: call.function.name, arguments: args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  // Unreachable in practice — the final iteration always runs without tools,
  // so it cannot request another round — kept as a defensive backstop.
  throw new Error(`Agent loop did not converge within ${maxIterations} iterations`);
}

module.exports = { runAgentLoop, DEFAULT_MAX_ITERATIONS };
