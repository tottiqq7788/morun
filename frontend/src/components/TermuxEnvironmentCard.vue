<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ClipboardCopy, ExternalLink, LoaderCircle, RefreshCw, Smartphone, Terminal } from '@lucide/vue'
import { morunNativeBridge, type TermuxStatus } from '../native/morunNative'

type DiagnosticState = 'idle' | 'running' | 'ready' | 'package_missing' | 'error'

interface Diagnostic {
  state: DiagnosticState
  text: string
}

const nativeBridge = morunNativeBridge
const termuxStatus = ref<TermuxStatus | null>(null)
const diagnostic = ref<Diagnostic>({
  state: 'idle',
  text: '尚未运行诊断。',
})
const isChecking = ref(false)
const isRunningDiagnostic = ref(false)
const setupCopied = ref(false)
const setupCommand =
  "mkdir -p ~/.termux && (grep -qxF 'allow-external-apps=true' ~/.termux/termux.properties 2>/dev/null || echo 'allow-external-apps=true' >> ~/.termux/termux.properties) && pkg update && pkg install -y termux-api"

onMounted(() => {
  void refreshStatus()
})

async function refreshStatus() {
  isChecking.value = true
  try {
    termuxStatus.value = await nativeBridge.termuxStatus()
  } finally {
    isChecking.value = false
  }
}

async function runDiagnostic() {
  isRunningDiagnostic.value = true
  diagnostic.value = {
    state: 'running',
    text: '正在读取电池状态。',
  }

  try {
    await refreshStatus()
    const status = termuxStatus.value
    if (status?.termuxInstalled && !status.runCommandPermissionGranted) {
      termuxStatus.value = await nativeBridge.requestTermuxRunCommandPermission()
    }

    const authorizedStatus = termuxStatus.value
    if (!authorizedStatus?.canRunCommands) {
      diagnostic.value = {
        state: 'error',
        text: authorizedStatus?.message || 'Termux RUN_COMMAND 尚未就绪。',
      }
      return
    }

    const result = await nativeBridge.runTermuxCommand({
      requestId: `termux_diagnostic_${Date.now()}`,
      command: 'termux-battery-status',
      timeoutMs: 15000,
    })

    if (result.exitCode === 0) {
      diagnostic.value = {
        state: 'ready',
        text: 'Termux:API 命令可用。',
      }
      return
    }

    const detail = `${result.stderr}\n${result.stdout}\n${result.errmsg ?? ''}`.toLowerCase()
    const packageMissing = detail.includes('not found') || detail.includes('no such file')
    diagnostic.value = {
      state: packageMissing ? 'package_missing' : 'error',
      text: packageMissing ? 'Termux 内未安装 termux-api 包。' : 'Termux 诊断命令执行失败。',
    }
  } finally {
    isRunningDiagnostic.value = false
  }
}

async function copySetupCommand() {
  await navigator.clipboard?.writeText(setupCommand)
  setupCopied.value = true
  window.setTimeout(() => {
    setupCopied.value = false
  }, 1800)
}

function statusLabel() {
  const status = termuxStatus.value
  if (!status) return '检测中'
  if (!status.available && status.message.includes('仅 Android')) return '不可用'
  if (!status.termuxInstalled) return '未安装 Termux'
  if (!status.runCommandPermissionGranted) return '未授权 RUN_COMMAND'
  if (!status.termuxApiInstalled) return '未安装 Termux:API'
  if (!status.available) return '不可用'
  if (diagnostic.value.state === 'package_missing') return '未安装 termux-api 包'
  if (diagnostic.value.state === 'ready') return '已就绪'
  return '待初始化'
}

function statusDescription() {
  const status = termuxStatus.value
  if (!status) return '正在检测 Android 执行环境。'
  if (!status.available && status.message.includes('仅 Android')) return status.message
  if (!status.termuxInstalled) return '需要先安装 Termux。'
  if (!status.runCommandPermissionGranted) return '需要允许 morun 调用 Termux RUN_COMMAND。'
  if (!status.termuxApiInstalled) return '手机能力工具需要安装 Termux:API app。'
  if (!status.available) return status.message
  if (diagnostic.value.state !== 'idle') return diagnostic.value.text
  return '运行诊断可确认 Termux 内的 termux-api 包是否可用。'
}

function statusTone() {
  const status = termuxStatus.value
  if (status?.canRunCommands && status.termuxApiInstalled && diagnostic.value.state === 'ready') return 'ready'
  if (diagnostic.value.state === 'running' || isChecking.value) return 'checking'
  if (!status?.available || !status.termuxInstalled || !status.runCommandPermissionGranted || !status.termuxApiInstalled) return 'blocked'
  if (diagnostic.value.state === 'package_missing' || diagnostic.value.state === 'error') return 'blocked'
  return 'pending'
}
</script>

<template>
  <section class="settings-section">
    <div class="section-heading">
      <h3>Termux 执行环境</h3>
      <span :class="['termux-status-pill', statusTone()]">{{ statusLabel() }}</span>
    </div>

    <div class="termux-card">
      <div class="termux-status-row">
        <Smartphone :size="18" />
        <span>{{ statusDescription() }}</span>
      </div>

      <div class="termux-actions">
        <button class="secondary-button compact" type="button" @click="nativeBridge.openTermuxInstallPage">
          <ExternalLink :size="15" />
          Termux
        </button>
        <button class="secondary-button compact" type="button" @click="nativeBridge.openTermuxApiInstallPage">
          <ExternalLink :size="15" />
          Termux:API
        </button>
        <button class="secondary-button compact" type="button" @click="nativeBridge.openTermuxApp">
          <Terminal :size="15" />
          打开
        </button>
        <button class="secondary-button compact" type="button" :disabled="isChecking || isRunningDiagnostic" @click="runDiagnostic">
          <LoaderCircle v-if="isRunningDiagnostic" class="spin" :size="15" />
          <RefreshCw v-else :size="15" />
          诊断
        </button>
        <button class="secondary-button compact" type="button" @click="copySetupCommand">
          <ClipboardCopy :size="15" />
          {{ setupCopied ? '已复制' : '初始化命令' }}
        </button>
      </div>

      <code class="termux-command">{{ setupCommand }}</code>
    </div>
  </section>
</template>

<style scoped>
.termux-card {
  background: rgba(255, 253, 249, 0.72);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 12px;
  padding: 12px;
}

.termux-status-pill {
  border: 1px solid rgba(125, 115, 104, 0.2);
  border-radius: 999px;
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 850;
  padding: 4px 8px;
  white-space: nowrap;
}

.termux-status-pill.ready {
  background: var(--success-soft);
  color: var(--success);
}

.termux-status-pill.checking {
  background: #e8f0f4;
  color: #2f6276;
}

.termux-status-pill.pending {
  background: #fff0c8;
  color: #7c5c12;
}

.termux-status-pill.blocked {
  background: var(--warn-soft);
  color: var(--warn);
}

.termux-status-row {
  align-items: center;
  color: var(--muted);
  display: grid;
  font-size: 13px;
  gap: 9px;
  grid-template-columns: 20px minmax(0, 1fr);
  line-height: 1.45;
}

.termux-status-row svg {
  color: var(--accent-strong);
}

.termux-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.termux-actions .secondary-button {
  min-width: 84px;
}

.termux-command {
  background: #f4efe7;
  border: 1px solid rgba(125, 115, 104, 0.16);
  border-radius: 7px;
  color: #504338;
  display: block;
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  padding: 9px;
}
</style>
