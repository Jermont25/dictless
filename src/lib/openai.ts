export type FileTranscribeModel =
  | "gpt-transcribe"
  | "gpt-4o-transcribe"
  | "gpt-4o-mini-transcribe"
  | "gpt-4o-transcribe-diarize"
  | "whisper-1"

export type TranscribeModelDefinition = {
  id: FileTranscribeModel
  label: string
  description: string
  capabilities: string[]
  supportsContext?: boolean
  supportsLanguageHints?: boolean
  supportsKeywords?: boolean
  supportsTranslation?: boolean
}

export const TRANSCRIBE_MODELS: readonly TranscribeModelDefinition[] = [
  {
    id: "gpt-transcribe",
    label: "GPT Transcribe",
    description:
      "Recomendado para archivos; alta precisión y detección de idioma.",
    capabilities: [
      "Detecta idiomas",
      "Contexto y palabras clave",
      "Audio multilingüe",
    ],
    supportsContext: true,
    supportsLanguageHints: true,
    supportsKeywords: true,
  },
  {
    id: "gpt-4o-transcribe",
    label: "GPT-4o Transcribe",
    description: "Modelo GPT-4o para transcripciones precisas.",
    capabilities: ["Contexto mediante prompt", "Integración existente"],
    supportsContext: true,
  },
  {
    id: "gpt-4o-mini-transcribe",
    label: "GPT-4o mini Transcribe",
    description: "Alternativa GPT-4o más económica para transcripción.",
    capabilities: ["Contexto mediante prompt", "Menor coste"],
    supportsContext: true,
  },
  {
    id: "gpt-4o-transcribe-diarize",
    label: "GPT-4o Transcribe Diarize",
    description: "Identifica a los hablantes de una grabación.",
    capabilities: [
      "Etiquetas de hablante",
      "Requiere procesamiento por bloques",
    ],
  },
  {
    id: "whisper-1",
    label: "Whisper",
    description: "Modelo clásico; permite traducir una grabación al inglés.",
    capabilities: ["Traducción al inglés", "Subtítulos y timestamps vía API"],
    supportsContext: true,
    supportsTranslation: true,
  },
] as const

export type TranscribeOptions = {
  model: FileTranscribeModel
  prompt?: string
  languages?: string[]
  keywords?: string[]
  translateToEnglish?: boolean
}

export function isFileTranscribeModel(
  value: string | null,
): value is FileTranscribeModel {
  return TRANSCRIBE_MODELS.some((model) => model.id === value)
}

export function getTranscribeModel(model: FileTranscribeModel) {
  return TRANSCRIBE_MODELS.find((candidate) => candidate.id === model)!
}

function readApiError(status: number, payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message
  }
  return `Error ${status} al procesar el audio.`
}

export async function transcribeAudio(
  audioBlob: Blob,
  options: TranscribeOptions,
): Promise<string> {
  if (audioBlob.size > 25 * 1024 * 1024) {
    throw new Error(
      "El audio supera el límite de 25 MB para transcripción de archivos.",
    )
  }

  const modelDefinition = getTranscribeModel(options.model)
  const extension = audioBlob.type.includes("webm") ? "webm" : "wav"
  const formData = new FormData()
  formData.append("file", audioBlob, `dictado.${extension}`)
  formData.append("model", options.model)

  if (options.translateToEnglish) {
    if (!modelDefinition.supportsTranslation) {
      throw new Error("Sólo Whisper admite traducir grabaciones al inglés.")
    }
  } else if (options.model === "gpt-4o-transcribe-diarize") {
    formData.append("response_format", "diarized_json")
    formData.append("chunking_strategy", "auto")
  }

  const prompt = options.prompt?.trim()
  if (prompt && modelDefinition.supportsContext)
    formData.append("prompt", prompt)

  if (options.model === "gpt-transcribe") {
    options.languages?.forEach((language) =>
      formData.append("languages[]", language),
    )
    options.keywords?.forEach((keyword) =>
      formData.append("keywords[]", keyword),
    )
  }

  const endpoint = options.translateToEnglish
    ? "/api/openai/audio/translations"
    : "/api/openai/audio/transcriptions"
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  })

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(readApiError(response.status, data))

  if (!data || typeof data !== "object") return ""

  if (
    options.model === "gpt-4o-transcribe-diarize" &&
    "segments" in data &&
    Array.isArray(data.segments)
  ) {
    const segments = data.segments
      .map((segment) => {
        if (!segment || typeof segment !== "object") return ""
        const speaker =
          "speaker" in segment && typeof segment.speaker === "string"
            ? segment.speaker
            : "Hablante"
        const text =
          "text" in segment && typeof segment.text === "string"
            ? segment.text.trim()
            : ""
        return text ? `${speaker}: ${text}` : ""
      })
      .filter(Boolean)
      .join("\n")
    if (segments) return segments
  }

  return "text" in data && typeof data.text === "string" ? data.text.trim() : ""
}
