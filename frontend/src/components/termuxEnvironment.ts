import type { TermuxStatus } from '../native/morunNative'

export type TermuxDiagnosticState = 'idle' | 'running' | 'ready' | 'package_missing' | 'error'

export function shouldAutoRunTermuxDiagnostic(
  status: TermuxStatus | null,
  diagnosticState: TermuxDiagnosticState,
  isRunningDiagnostic: boolean,
) {
  return Boolean(
    status?.canRunCommands &&
      status.termuxApiInstalled &&
      diagnosticState === 'idle' &&
      !isRunningDiagnostic,
  )
}
