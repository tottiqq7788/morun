import { describe, expect, it } from 'vitest'
import type { TermuxStatus } from '../native/morunNative'
import { shouldAutoRunTermuxDiagnostic } from './termuxEnvironment'

const readyStatus: TermuxStatus = {
  available: true,
  termuxInstalled: true,
  termuxApiInstalled: true,
  runCommandPermissionGranted: true,
  canRunCommands: true,
  message: 'ready',
}

describe('shouldAutoRunTermuxDiagnostic', () => {
  it('auto-runs once when Termux commands and Termux:API app are already available', () => {
    expect(shouldAutoRunTermuxDiagnostic(readyStatus, 'idle', false)).toBe(true)
  })

  it('does not auto-run when permission or Termux:API app is missing', () => {
    expect(
      shouldAutoRunTermuxDiagnostic(
        {
          ...readyStatus,
          available: false,
          runCommandPermissionGranted: false,
          canRunCommands: false,
        },
        'idle',
        false,
      ),
    ).toBe(false)
    expect(shouldAutoRunTermuxDiagnostic({ ...readyStatus, termuxApiInstalled: false }, 'idle', false)).toBe(false)
  })

  it('does not repeat automatic diagnostics after a diagnostic state is set', () => {
    expect(shouldAutoRunTermuxDiagnostic(readyStatus, 'ready', false)).toBe(false)
    expect(shouldAutoRunTermuxDiagnostic(readyStatus, 'error', false)).toBe(false)
    expect(shouldAutoRunTermuxDiagnostic(readyStatus, 'idle', true)).toBe(false)
  })
})
