<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, ClipboardCopy, ExternalLink, LoaderCircle, RefreshCw, Smartphone, Terminal, X } from '@lucide/vue'
import { morunNativeBridge, type TermuxStatus } from '../native/morunNative'
import { shouldAutoRunTermuxDiagnostic, type TermuxDiagnosticState } from './termuxEnvironment'

interface Diagnostic {
  state: TermuxDiagnosticState
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
const termuxDialogOpen = ref(false)
const setupCommand =
  "mkdir -p ~/.termux && (grep -qxF 'allow-external-apps=true' ~/.termux/termux.properties 2>/dev/null || echo 'allow-external-apps=true' >> ~/.termux/termux.properties) && pkg update && pkg install -y termux-api"

const activeStep = computed(() => {
  const status = termuxStatus.value
  if (!status) return 1
  if (!status.available && status.message.includes('仅 Android')) return 0
  if (!status.termuxInstalled || !status.termuxApiInstalled) return 1
  if (diagnostic.value.state === 'ready') return 4
  if (!status.runCommandPermissionGranted || !status.canRunCommands) return 3
  return 2
})

onMounted(async () => {
  await refreshStatus()
  if (shouldAutoRunTermuxDiagnostic(termuxStatus.value, diagnostic.value.state, isRunningDiagnostic.value)) {
    await runDiagnostic({ automatic: true, requestPermission: false })
  }
})

async function refreshStatus() {
  isChecking.value = true
  try {
    termuxStatus.value = await nativeBridge.termuxStatus()
    return termuxStatus.value
  } finally {
    isChecking.value = false
  }
}

async function runDiagnostic({
  automatic = false,
  requestPermission = true,
}: {
  automatic?: boolean
  requestPermission?: boolean
} = {}) {
  isRunningDiagnostic.value = true
  diagnostic.value = {
    state: 'running',
    text: automatic ? '正在自动检测 Termux 可用性。' : '正在读取电池状态。',
  }

  try {
    await refreshStatus()
    const status = termuxStatus.value
    if (requestPermission && status?.termuxInstalled && !status.runCommandPermissionGranted) {
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
  return '打开配置后按步骤初始化，再运行诊断确认 Termux 内的 termux-api 包可用。'
}

function statusTone() {
  const status = termuxStatus.value
  if (status?.canRunCommands && status.termuxApiInstalled && diagnostic.value.state === 'ready') return 'ready'
  if (diagnostic.value.state === 'running' || isChecking.value) return 'checking'
  if (!status?.available || !status.termuxInstalled || !status.runCommandPermissionGranted || !status.termuxApiInstalled) return 'blocked'
  if (diagnostic.value.state === 'package_missing' || diagnostic.value.state === 'error') return 'blocked'
  return 'pending'
}

function stepTone(step: number) {
  if (activeStep.value === 0) return 'idle'
  if (activeStep.value === 4) return 'done'
  if (step < activeStep.value) return 'done'
  if (step === activeStep.value) return 'active'
  return 'idle'
}
</script>

<template>
  <section class="settings-section">
    <div class="section-heading">
      <h3>第三方工具配置</h3>
      <span>1 个配置</span>
    </div>

    <button class="third-party-config-card" type="button" @click="termuxDialogOpen = true">
      <span class="third-party-config-main">
        <strong>Termux</strong>
        <small>Termux:API 手机能力连接</small>
        <span>{{ statusDescription() }}</span>
      </span>
      <span :class="['termux-status-pill', statusTone()]">{{ statusLabel() }}</span>
      <span class="config-action">配置</span>
    </button>

    <section v-if="termuxDialogOpen" class="termux-config-dialog-layer" aria-label="Termux 配置" @click.self="termuxDialogOpen = false">
      <div class="termux-config-dialog">
        <header>
          <div>
            <p class="eyebrow">第三方工具</p>
            <h2>Termux 配置</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭 Termux 配置" title="关闭 Termux 配置" @click="termuxDialogOpen = false">
            <X :size="18" />
          </button>
        </header>

        <div class="termux-dialog-body">
          <div class="termux-status-row">
            <Smartphone :size="18" />
            <span>{{ statusDescription() }}</span>
          </div>

          <ol class="termux-steps">
            <li :class="['termux-step', stepTone(1)]">
              <span class="termux-step-index">
                <Check v-if="stepTone(1) === 'done'" :size="14" />
                <span v-else>1</span>
              </span>
              <div class="termux-step-body">
                <strong>安装基础应用</strong>
                <p>先安装 Termux，再安装 Termux:API，用来连接手机能力。</p>
                <div class="termux-step-actions">
                  <button class="secondary-button compact" type="button" @click="nativeBridge.openTermuxInstallPage">
                    <ExternalLink :size="15" />
                    Termux
                  </button>
                  <button class="secondary-button compact" type="button" @click="nativeBridge.openTermuxApiInstallPage">
                    <ExternalLink :size="15" />
                    Termux:API
                  </button>
                </div>
              </div>
            </li>

            <li :class="['termux-step', stepTone(2)]">
              <span class="termux-step-index">
                <Check v-if="stepTone(2) === 'done'" :size="14" />
                <span v-else>2</span>
              </span>
              <div class="termux-step-body">
                <strong>打开 Termux 并初始化</strong>
                <p>复制初始化命令，打开 Termux 粘贴执行一次。</p>
                <div class="termux-step-actions">
                  <button class="secondary-button compact" type="button" @click="nativeBridge.openTermuxApp">
                    <Terminal :size="15" />
                    打开
                  </button>
                  <button class="secondary-button compact" type="button" @click="copySetupCommand">
                    <ClipboardCopy :size="15" />
                    {{ setupCopied ? '已复制' : '复制命令' }}
                  </button>
                </div>
                <details class="termux-command-details">
                  <summary>查看初始化命令</summary>
                  <code class="termux-command">{{ setupCommand }}</code>
                </details>
              </div>
            </li>

            <li :class="['termux-step', stepTone(3)]">
              <span class="termux-step-index">
                <Check v-if="stepTone(3) === 'done'" :size="14" />
                <span v-else>3</span>
              </span>
              <div class="termux-step-body">
                <strong>授权并诊断</strong>
                <p>允许 morun 调用 RUN_COMMAND，然后检查 Termux:API 命令是否可用。</p>
                <div class="termux-step-actions">
                  <button class="secondary-button compact" type="button" :disabled="isChecking || isRunningDiagnostic" @click="runDiagnostic()">
                    <LoaderCircle v-if="isRunningDiagnostic" class="spin" :size="15" />
                    <RefreshCw v-else :size="15" />
                    {{ isRunningDiagnostic ? '诊断中' : '授权诊断' }}
                  </button>
                </div>
              </div>
            </li>

            <li :class="['termux-step', stepTone(4)]">
              <span class="termux-step-index">
                <Check v-if="stepTone(4) === 'done'" :size="14" />
                <span v-else>4</span>
              </span>
              <div class="termux-step-body">
                <strong>完成后启用工具</strong>
                <p>状态变为已就绪后，再到工具目录开启需要的 Termux 工具。</p>
              </div>
            </li>
          </ol>
        </div>

        <footer>
          <button class="secondary-button" type="button" @click="termuxDialogOpen = false">关闭</button>
        </footer>
      </div>
    </section>
  </section>
</template>

<style scoped>
.third-party-config-card {
  align-items: center;
  background: rgba(255, 253, 249, 0.72);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  cursor: pointer;
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) auto auto;
  min-height: 74px;
  padding: 11px;
  text-align: left;
  width: 100%;
}

.third-party-config-card:hover {
  background: #fffdf9;
  border-color: #cdbca9;
}

.third-party-config-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.third-party-config-main strong {
  font-size: 14px;
  font-weight: 850;
}

.third-party-config-main small,
.third-party-config-main span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.third-party-config-main small {
  white-space: nowrap;
}

.third-party-config-main span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.config-action {
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 850;
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

.termux-config-dialog-layer {
  align-items: center;
  animation: fade-in 160ms ease both;
  background: rgba(39, 34, 28, 0.34);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 18px;
  position: fixed;
  z-index: 13;
}

.termux-config-dialog {
  background: var(--panel);
  border-radius: 8px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  max-height: min(760px, 92svh);
  max-width: 520px;
  overflow: hidden;
  width: min(100%, 520px);
}

.termux-config-dialog > header,
.termux-config-dialog footer {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 16px 18px;
}

.termux-config-dialog > header {
  border-bottom: 1px solid var(--line);
}

.termux-config-dialog footer {
  border-top: 1px solid var(--line);
  justify-content: flex-end;
}

.termux-dialog-body {
  display: grid;
  gap: 13px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
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

.termux-steps {
  display: grid;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.termux-step {
  display: grid;
  gap: 10px;
  grid-template-columns: 28px minmax(0, 1fr);
}

.termux-step-index {
  align-items: center;
  align-self: start;
  background: var(--panel-deep);
  border: 1px solid rgba(125, 115, 104, 0.2);
  border-radius: 999px;
  color: var(--accent-strong);
  display: inline-flex;
  font-size: 12px;
  font-weight: 850;
  height: 28px;
  justify-content: center;
  width: 28px;
}

.termux-step.active .termux-step-index {
  background: #fff0c8;
  color: #7c5c12;
}

.termux-step.done .termux-step-index {
  background: var(--success-soft);
  color: var(--success);
}

.termux-step-body {
  border-bottom: 1px solid rgba(125, 115, 104, 0.14);
  display: grid;
  gap: 7px;
  min-width: 0;
  padding-bottom: 10px;
}

.termux-step:last-child .termux-step-body {
  border-bottom: 0;
  padding-bottom: 0;
}

.termux-step-body strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 850;
}

.termux-step-body p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.termux-step-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.termux-step-actions .secondary-button {
  min-width: 84px;
}

.termux-command-details {
  color: var(--muted);
  font-size: 12px;
}

.termux-command-details summary {
  cursor: pointer;
  font-weight: 800;
}

.termux-command {
  background: #f4efe7;
  border: 1px solid rgba(125, 115, 104, 0.16);
  border-radius: 7px;
  color: #504338;
  display: block;
  font-size: 11px;
  line-height: 1.5;
  margin-top: 8px;
  overflow-wrap: anywhere;
  padding: 9px;
}

@media (max-width: 720px) {
  .third-party-config-card {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .config-action {
    grid-column: 2;
  }
}
</style>
