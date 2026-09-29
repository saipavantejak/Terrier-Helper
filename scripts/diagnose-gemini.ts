import { GoogleGenAI, ApiError } from '@google/genai';
// Deployment-only synthetic probe: never sends documents or prints credentials.
const key = process.env.GEMINI_API_KEY;
if (key) {
  const ai = new GoogleGenAI({apiKey:key,httpOptions:{timeout:15000}});
  const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const fallback = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash';
  for (const model of [...new Set([primary,fallback])]) {
    try {
      const result = await ai.models.generateContent({model,contents:'Reply with exactly OK.',config:{maxOutputTokens:64}});
      console.log(JSON.stringify({probe:'gemini_minimal',model,ok:!!result.text,finish:result.candidates?.[0]?.finishReason}));
    } catch (error) {
      const message = error instanceof Error ? error.message.split(key).join('[REDACTED]').replace(/AIza[\w-]+/g,'[REDACTED]').slice(0,1000) : 'unknown';
      console.log(JSON.stringify({probe:'gemini_minimal',model,status:error instanceof ApiError?error.status:null,message}));
    }
  }
} else console.log('Gemini diagnostic skipped: key not configured');
