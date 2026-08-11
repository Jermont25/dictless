import { useEffect, useMemo, useState } from "react"
import {
  Check,
  Copy,
  Info,
  Languages,
  Loader2,
  Mic,
  Settings2,
  Square,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAudioRecorder } from "@/hooks/useAudioRecorder"
import {
  getTranscribeModel,
  isFileTranscribeModel,
  transcribeAudio,
  TRANSCRIBE_MODELS,
  type FileTranscribeModel,
} from "@/lib/openai"

const MODEL_STORAGE = "dictado_openai_model"
const CONTEXT_PRESETS = [
  {
    label: "Mensaje de Slack",
    value: "Estoy dictando un mensaje que voy a enviar por Slack.",
  },
  {
    label: "Instrucción a agente de IA",
    value: "Estoy dictando un mensaje con instrucciones para un agente de IA.",
  },
  {
    label: "Tarea",
    value: "Estoy redactando los detalles de una tarea.",
  },
] as const

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0")
  const s = (totalSeconds % 60).toString().padStart(2, "0")
  return `${m}:${s}`
}

function csvValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export default function App() {
  const [model, setModel] = useState<FileTranscribeModel>(() => {
    const saved = localStorage.getItem(MODEL_STORAGE)
    return isFileTranscribeModel(saved) ? saved : "gpt-transcribe"
  })
  const [prompt, setPrompt] = useState("")
  const [languages, setLanguages] = useState("")
  const [keywords, setKeywords] = useState("")
  const [translateToEnglish, setTranslateToEnglish] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const recorder = useAudioRecorder()
  const isRecording = recorder.status === "recording"
  const selectedModel = getTranscribeModel(model)

  useEffect(() => {
    localStorage.setItem(MODEL_STORAGE, model)
  }, [model])

  const ringScale = useMemo(() => 1 + recorder.level * 0.35, [recorder.level])

  async function handleToggleRecording() {
    setApiError(null)
    if (isRecording) {
      const blob = await recorder.stop()
      if (!blob) return
      setIsTranscribing(true)
      try {
        const text = await transcribeAudio(blob, {
          model,
          prompt,
          languages: csvValues(languages),
          keywords: csvValues(keywords),
          translateToEnglish,
        })
        if (text) setTranscript(text)
      } catch (error) {
        setApiError(
          error instanceof Error
            ? error.message
            : "Ocurrió un error al transcribir.",
        )
      } finally {
        setIsTranscribing(false)
      }
    } else {
      await recorder.start()
    }
  }

  async function handleCopy() {
    if (!transcript) return
    await navigator.clipboard.writeText(transcript)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const busy = isTranscribing || recorder.status === "stopping"
  const operationLabel = translateToEnglish
    ? "Traduciendo al inglés…"
    : "Transcribiendo…"

  return (
    <main className="min-h-screen bg-background">
      <div className="container max-w-3xl py-10 md:py-16">
        <header className="mb-10 flex items-start justify-between gap-6 border-b border-border pb-7">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em] md:text-4xl">
              Dictless
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Convierte grabaciones en texto con modelos de transcripción de
              OpenAI.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Ajustes"
          >
            <Settings2 className="h-5 w-5" />
          </Button>
        </header>

        {settingsOpen && (
          <Card className="mb-8 animate-fade-in bg-card shadow-none">
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2">
                <Label htmlFor="model">Modelo</Label>
                <select
                  id="model"
                  value={model}
                  disabled={busy || isRecording}
                  onChange={(event) => {
                    const nextModel = event.target.value as FileTranscribeModel
                    setModel(nextModel)
                    if (!getTranscribeModel(nextModel).supportsTranslation)
                      setTranslateToEnglish(false)
                  }}
                  className="flex h-11 w-full rounded-md border border-input bg-secondary px-3 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {TRANSCRIBE_MODELS.map((definition) => (
                    <option key={definition.id} value={definition.id}>
                      {definition.label}
                    </option>
                  ))}
                </select>
                <div className="rounded-md border border-border bg-secondary px-3 py-3">
                  <p className="text-sm font-medium">
                    {selectedModel.description}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {selectedModel.capabilities.join(" · ")}
                  </p>
                </div>
              </div>

              {selectedModel.supportsContext && (
                <div className="space-y-2">
                  <Label htmlFor="prompt">
                    Contexto{" "}
                    <span className="font-normal text-muted-foreground">
                      (opcional)
                    </span>
                  </Label>
                  <Input
                    id="prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Ej.: reunión sobre el proyecto Atlas y la cuenta AC-42"
                    className="bg-secondary"
                  />
                  <div className="flex flex-wrap gap-2 pt-1">
                    {CONTEXT_PRESETS.map((preset) => (
                      <Button
                        key={preset.label}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPrompt(preset.value)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {selectedModel.supportsLanguageHints && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="languages">
                      Idiomas esperados{" "}
                      <span className="font-normal text-muted-foreground">
                        (opcional)
                      </span>
                    </Label>
                    <Input
                      id="languages"
                      value={languages}
                      onChange={(event) => setLanguages(event.target.value)}
                      placeholder="es, en"
                      className="bg-secondary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="keywords">
                      Palabras clave{" "}
                      <span className="font-normal text-muted-foreground">
                        (opcional)
                      </span>
                    </Label>
                    <Input
                      id="keywords"
                      value={keywords}
                      onChange={(event) => setKeywords(event.target.value)}
                      placeholder="Atlas, AC-42"
                      className="bg-secondary"
                    />
                  </div>
                </div>
              )}

              {selectedModel.supportsTranslation && (
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-secondary p-3">
                  <input
                    type="checkbox"
                    checked={translateToEnglish}
                    onChange={(event) =>
                      setTranslateToEnglish(event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--link))]"
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Languages className="h-4 w-4 text-link" /> Traducir al
                      inglés
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Whisper es el único modelo de esta lista que admite esta
                      operación.
                    </span>
                  </span>
                </label>
              )}
            </CardContent>
          </Card>
        )}

        <section
          className="flex flex-col items-center gap-4 border-b border-border py-10 md:py-12"
          aria-label="Grabación"
        >
          <div className="relative flex h-32 w-32 items-center justify-center">
            {isRecording && (
              <span
                className="absolute inset-0 rounded-full bg-foreground/10 animate-pulse-ring"
                style={{ transform: `scale(${ringScale})` }}
              />
            )}
            <button
              type="button"
              onClick={handleToggleRecording}
              disabled={busy}
              className={`relative flex h-20 w-20 items-center justify-center rounded-full border transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                isRecording
                  ? "border-destructive bg-destructive text-destructive-foreground"
                  : "border-foreground bg-foreground text-background hover:scale-[1.03]"
              }`}
              style={
                isRecording ? { transform: `scale(${ringScale})` } : undefined
              }
              aria-label={
                isRecording ? "Detener grabación" : "Empezar a grabar"
              }
            >
              {busy ? (
                <Loader2 className="h-7 w-7 animate-spin" />
              ) : isRecording ? (
                <Square className="h-6 w-6" />
              ) : (
                <Mic className="h-7 w-7" />
              )}
            </button>
          </div>

          <div className="h-6 font-numeric text-sm text-muted-foreground">
            {isRecording
              ? formatTime(recorder.seconds)
              : isTranscribing
                ? operationLabel
                : "Listo para grabar"}
          </div>

          {(recorder.error || apiError) && (
            <p className="max-w-md text-center text-sm leading-6 text-destructive">
              {recorder.error || apiError}
            </p>
          )}
        </section>

        <section className="pt-8" aria-label="Transcripción">
          <Card className="shadow-none">
            <CardContent className="pt-6">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <Label
                    htmlFor="transcript"
                    className="font-medium text-foreground"
                  >
                    Transcripción
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Editable antes de copiar. Cada grabación se añade al final.
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setTranscript("")}
                    disabled={!transcript}
                    aria-label="Limpiar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    disabled={!transcript}
                    aria-label="Copiar"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-link" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <Textarea
                id="transcript"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder="El texto transcrito aparecerá aquí. Puedes editarlo antes de copiarlo."
                className="min-h-[240px] resize-y border-border bg-secondary text-[15px] leading-7"
              />
            </CardContent>
          </Card>

          <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-link" />
            La transcripción generada puede tener errores. Verifica el texto antes de enviarlo.
          </p>
        </section>
      </div>
    </main>
  )
}
