# morun

morun 是一个面向 Android 手机端的 Agent 应用雏形。第一版聚焦两个能力：

- 模型配置：提供常见模型厂商预设、接口密钥配置、连接测试和模型下拉选择。
- 多会话聊天：支持创建、切换、删除、重命名会话，并在本地保存会话与模型配置。

当前项目采用 Web 技术作为主要界面层，通过 Capacitor 打包为 Android APK。后续可以继续加入 Kotlin 原生桥、Termux 工具调用、更多本机能力和可选云端服务。

## 技术栈

- 前端：Vue 3 + TypeScript + Vite
- 移动容器：Capacitor
- Android 原生层：Kotlin/Java + Gradle
- 后端：第一版暂无，`backend` 目录预留给后续 Go 服务

## 目录结构

```text
morun/
  frontend/   Vue 3 前端与 Capacitor 配置
  android/    Capacitor 生成的 Android 工程
  backend/    预留后端目录
  docs/       项目文档目录
```

## 本地开发

进入前端目录安装依赖并启动开发服务：

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

默认访问地址：

```text
http://127.0.0.1:5173/
```

## 构建 Web 资源

```bash
cd frontend
npm run build
```

## 同步到 Android

```bash
cd frontend
npm run cap:sync
```

## 构建 Android Debug APK

在 Windows 上可以使用 Android Studio 自带的 JDK：

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
cd ..\android
.\gradlew.bat assembleDebug
```

构建产物位置：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 当前说明

- 模型接口按 OpenAI-compatible 形式调用 `/chat/completions`。
- “测试连接”会请求厂商的 `/models` 接口并刷新模型下拉列表。
- 浏览器环境下部分厂商可能因为 CORS 拦截测试连接；后续接入 Kotlin 原生网络桥后可以绕过浏览器跨域限制。
- 会话和模型配置目前保存在浏览器本地存储中。
