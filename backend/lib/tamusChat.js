function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getApiBaseUrl() {
  return (process.env.TAMUS_AI_CHAT_API_ENDPOINT || 'https://chat-api.tamu.ai').replace(/\/$/, '');
}

// NOTE: 'protected.gemini-2.0-flash-lite' was retired from the TAMU AI catalog
// and every call started failing with 400 {"detail":"Model not found"}, which
// silently broke OCR, damage analysis and coverage. Check GET /api/models on
// the endpoint for the current catalog before changing this.
// gpt-4.1-mini: vision-capable, reliable JSON, ~3s round trip.
function getDefaultModel() {
  return process.env.TAMUS_AI_CHAT_MODEL || 'protected.gpt-4.1-mini';
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text') return item.text || '';
        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

function extractTextResponse(data) {
  const content = data?.choices?.[0]?.message?.content;
  const text = normalizeMessageContent(content);

  if (!text) {
    throw new Error(`Unexpected TAMUS AI response format: ${JSON.stringify(data)}`);
  }

  return text;
}

async function createChatCompletion({ messages, model = getDefaultModel(), temperature = 0, tools, tool_choice }) {
  const apiKey = getRequiredEnv('TAMUS_AI_CHAT_API_KEY');
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model, stream: false, temperature, messages,
          ...(tools ? { tools } : {}),
          ...(tool_choice ? { tool_choice } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        // `detail` is where this API puts "Model not found" — without it the
        // real reason is swallowed and every route just reports a bare 400.
        const reason = data?.error?.message || data?.message || data?.detail;
        throw new Error(
          reason
            ? `TAMUS AI error ${response.status} (model "${model}"): ${reason}`
            : `TAMUS AI error ${response.status} (model "${model}"): ${JSON.stringify(data).slice(0, 300)}`
        );
      }
      return data;
    } catch (err) {
      lastErr = err;
      const code = err.cause?.code;
      if ((code === 'ECONNRESET' || code === 'ECONNREFUSED') && attempt < 3) {
        console.warn(`[tamusChat] ${code} on attempt ${attempt}, retrying in ${800 * attempt}ms...`);
        await new Promise(res => setTimeout(res, 800 * attempt));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

function parseJsonResponse(text) {
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

function buildImageMessage({ promptText, imageBase64, mediaType = 'image/jpeg' }) {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: promptText,
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${imageBase64}`,
        },
      },
    ],
  };
}

module.exports = {
  buildImageMessage,
  createChatCompletion,
  extractTextResponse,
  parseJsonResponse,
};
