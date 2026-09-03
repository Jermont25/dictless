# Dictless

Aplicación web de uso personal y exclusivamente local para dictar mediante el micrófono y convertir las grabaciones en texto con la API de transcripción de OpenAI.

No está preparada para despliegue. El navegador graba el audio y lo envía al proxy del servidor local de Vite; ese proceso añade la API key al reenviar la solicitud a OpenAI.

## Funcionalidades

- Grabación de audio desde el micrófono, con duración y nivel de entrada visibles.
- Transcripción al terminar cada grabación.
- Acumulación de varias transcripciones en un único texto editable.
- Copia al portapapeles y limpieza manual del texto.
- Barra de progreso del día con horario configurable y guardado local.
- Opciones de contexto, idiomas esperados y palabras clave cuando el modelo las admite.
- Traducción de una grabación al inglés con `whisper-1`.
- Diarización por hablante con `gpt-4o-transcribe-diarize`.

## Requisitos

- Node.js 18 o superior.
- Un navegador moderno con acceso al micrófono.
- Una API key de OpenAI con acceso a los modelos de audio que vayas a utilizar. Puedes crearla en <https://platform.openai.com/api-keys>.

## Ejecutar en local

```bash
npm install
cp .env.example .env.local
npm run dev
```

Edita `.env.local` y sustituye `your_openai_api_key` por tu API key antes de iniciar el servidor. Abre en el navegador la dirección que indique Vite, normalmente <http://localhost:5173>.

El servidor local lee `OPENAI_API_KEY` desde `.env.local` y la añade a las solicitudes que reenvía a OpenAI. La variable no debe llevar el prefijo `VITE_`, ya que ese prefijo la expondría al navegador. Reinicia `npm run dev` después de modificar `.env.local`.

## Uso

1. En Ajustes, selecciona el modelo y las opciones que necesites.
2. Ajusta el horario de tu jornada en la barra de progreso del día si lo necesitas.
3. Pulsa el botón del micrófono y concede el permiso del navegador.
4. Pulsa de nuevo el botón para detener la grabación. El audio se transcribe cuando termina la captura.
5. Revisa o edita el texto resultante; las transcripciones posteriores se añaden al final.
6. Copia el texto o elimínalo con los botones del panel de transcripción.

## Modelos disponibles

| Modelo                      | Uso en la aplicación                                                        |
| --------------------------- | --------------------------------------------------------------------------- |
| `gpt-transcribe`            | Modelo predeterminado; admite contexto, idiomas esperados y palabras clave. |
| `gpt-4o-transcribe`         | Transcripción con contexto mediante `prompt`.                               |
| `gpt-4o-mini-transcribe`    | Alternativa de menor coste con contexto mediante `prompt`.                  |
| `gpt-4o-transcribe-diarize` | Transcripción con etiquetas de hablante.                                    |
| `whisper-1`                 | Transcripción con contexto y traducción de la grabación al inglés.          |

La aplicación solo implementa transcripción de archivos una vez terminada la grabación. No incluye modelos de audio en tiempo real: para ello sería necesario un backend que genere credenciales efímeras.

## Privacidad y seguridad

La API key queda solamente en `.env.local`, un archivo ignorado por Git. El navegador no la recibe: solo llama al proxy que sirve Vite en tu equipo. El audio se reenvía desde ese proxy a OpenAI para transcribirse.

- No añadas `.env.local` al control de versiones ni compartas su contenido.
- Configura límites de gasto y rota la key si crees que pudo quedar expuesta.
- El proxy está pensado exclusivamente para `localhost`; no publiques esta aplicación tal como está. Antes de exponerla en una URL pública, incorpora un backend con autenticación, autorización y controles de uso.

## Comandos disponibles

```bash
npm run dev           # inicia el servidor de desarrollo local
npm run build         # comprueba TypeScript y genera dist/
npm run preview       # sirve dist/ y el proxy local para revisar el build
npm run lint          # ejecuta ESLint sobre src/
npm run lint:fix      # corrige problemas de lint corregibles
npm run format:check  # verifica el formato con Prettier
npm run format        # aplica el formato con Prettier
```

## Tecnologías

- React 19, TypeScript y Vite.
- Tailwind CSS y componentes basados en shadcn/ui.
- `MediaRecorder`, `getUserMedia` y Web Audio API para la captura de audio.
- API de transcripciones de OpenAI, llamada desde el proxy local de Vite.

## Estructura relevante

```text
src/
  App.tsx                     interfaz y flujo de transcripción
  hooks/useAudioRecorder.ts   captura de micrófono y nivel de audio
  lib/openai.ts               modelos disponibles y petición a OpenAI
  components/ui/              componentes de interfaz
```
