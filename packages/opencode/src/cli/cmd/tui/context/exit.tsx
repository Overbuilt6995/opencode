import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { win32FlushInputBuffer } from "../win32"
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onBeforeExit?: () => Promise<void>; onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let message: string | undefined
    let task: Promise<void> | undefined
    const store = {
      set: (value?: string) => {
        const prev = message
        message = value
        return () => {
          message = prev
        }
      },
      clear: () => {
        message = undefined
      },
      get: () => message,
    }
    const exit: Exit = Object.assign(
      (reason?: unknown) => {
        if (task) return task
        task = (async () => {
          await input.onBeforeExit?.()
          // Reset window title before destroying renderer
          try { renderer.setTerminalTitle("") } catch {}
          // Disable mouse tracking before destroying renderer.
          // Must use the setter (not _useMouse directly) to trigger
          // the native disableMouse FFI which emits ANSI reset codes.
          // Raw stdout.write as safety net in case setter throws.
          const MOUSE_RESET = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l\x1b[?1015l\x1b[?2004l\x1b[?1049l\x1b[?25h\x1b[0m"
          try { renderer.useMouse = false } catch {}
          try { process.stdout.write(MOUSE_RESET) } catch {}
          renderer.destroy()
          win32FlushInputBuffer()
          // Restore stdin to cooked mode on non-Windows platforms
          if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(false) } catch {}
          }
          if (reason) {
            const formatted = FormatError(reason) ?? FormatUnknownError(reason)
            if (formatted) {
              process.stderr.write(formatted + "\n")
            }
          }
          const text = store.get()
          if (text) process.stdout.write(text + "\n")
          await input.onExit?.()
        })()
        return task
      },
      {
        message: store,
      },
    )
    process.on("SIGHUP", () => exit())
    return exit
  },
})
