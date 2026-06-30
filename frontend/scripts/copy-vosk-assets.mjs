import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptDir, '..')
const projectDir = resolve(frontendDir, '..')
const defaultModelDir = resolve(
  projectDir,
  '..',
  'side_branch',
  'vosk-test',
  'models',
  'vosk-model-small-cn-0.22',
)
const modelDir = process.env.MORUN_VOSK_MODEL_DIR
  ? resolve(process.env.MORUN_VOSK_MODEL_DIR)
  : defaultModelDir
const targetDir = resolve(projectDir, 'android', 'app', 'src', 'main', 'assets', 'model-zh-cn')

if (!existsSync(modelDir) || !statSync(modelDir).isDirectory()) {
  console.error(
    [
      'Vosk 中文模型目录不存在。',
      `当前查找目录：${modelDir}`,
      '请下载并解压 vosk-model-small-cn-0.22，或设置 MORUN_VOSK_MODEL_DIR 指向模型目录。',
      '模型下载页：https://alphacephei.com/vosk/models',
    ].join('\n'),
  )
  process.exit(1)
}

mkdirSync(dirname(targetDir), { recursive: true })
rmSync(targetDir, { recursive: true, force: true })
cpSync(modelDir, targetDir, { recursive: true })
console.log(`Copied Vosk model assets: ${modelDir} -> ${targetDir}`)
