// Voice-note transcription through a Whisper-class API. Same contract as
// the mailer: honest OFF until a key exists, then automatic. Groq's free
// tier is tried first (GROQ_API_KEY), then OpenAI (OPENAI_API_KEY) - both
// speak the same audio/transcriptions protocol and handle Hebrew as well
// as English.
export type TranscribeResult =
  | { ok: true; text: string; provider: string }
  | { ok: false; reason: string };

export async function transcribeAudio(
  bytes: ArrayBuffer,
  fileName: string,
  mime: string | null
): Promise<TranscribeResult> {
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const target = groq
    ? { url: "https://api.groq.com/openai/v1/audio/transcriptions", key: groq, model: "whisper-large-v3", provider: "groq" }
    : openai
      ? { url: "https://api.openai.com/v1/audio/transcriptions", key: openai, model: "whisper-1", provider: "openai" }
      : null;
  if (!target) {
    return { ok: false, reason: "Transcription is OFF - set GROQ_API_KEY (free tier) or OPENAI_API_KEY." };
  }

  try {
    const fd = new FormData();
    fd.append("file", new File([bytes], fileName, { type: mime ?? "audio/mp4" }));
    fd.append("model", target.model);
    fd.append("response_format", "text");
    const res = await fetch(target.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${target.key}` },
      body: fd,
    });
    if (!res.ok) {
      return { ok: false, reason: `${target.provider} answered ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const text = (await res.text()).trim();
    if (!text) return { ok: false, reason: "Empty transcription." };
    return { ok: true, text, provider: target.provider };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Transcription failed." };
  }
}
