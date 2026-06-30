package com.morun.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.PermissionState;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.StorageService;

@CapacitorPlugin(
    name = "MorunNative",
    permissions = {
        @Permission(alias = "termuxRunCommand", strings = { "com.termux.permission.RUN_COMMAND" }),
        @Permission(alias = "recordAudio", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class MorunNativePlugin extends Plugin {

    private static final String SECURE_PREFS_NAME = "morun_secure_store";
    private static final String VERSION = "0.5.1";
    private static final String TERMUX_HOME_PREFIX = "/data/data/com.termux/files/home/";
    private static final int MAX_IMAGE_MEDIA_BYTES = 12 * 1024 * 1024;
    private static final String DEBUG_LOG_TAG = "MorunDebug";
    private static final String DEBUG_LOG_DIR_NAME = "morun-debug";
    private static final String DEBUG_LOG_FILE_NAME = "events.jsonl";
    private static final long DEBUG_LOG_MAX_FILE_BYTES = 5L * 1024L * 1024L;
    private static final int DEBUG_LOG_MAX_FILES = 10;
    private static final int DEBUG_LOG_DEFAULT_READ_BYTES = 1024 * 1024;
    private static final String VOICE_DIR_NAME = "morun-voice";
    private static final String VOICE_MIME_TYPE = "audio/wav";
    private static final String VOSK_MODEL_ASSET = "model-zh-cn";
    private static final String VOSK_MODEL_STORAGE_DIR = "vosk-models";
    private static final int VOICE_SAMPLE_RATE = 16000;
    private static final int VOICE_MIN_DURATION_MS = 500;
    private static final int VOICE_MAX_DURATION_MS = 60000;
    private static final int VOICE_RECOGNIZER_CHUNK_BYTES = 4096;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();
    private final Map<String, Future<?>> activeRequests = new ConcurrentHashMap<>();
    private final Object voiceLock = new Object();
    private SharedPreferences securePreferences;
    private TermuxCommandBridge termuxCommandBridge;
    private ActiveVoiceRecording activeVoiceRecording;
    private volatile Model cachedVoskModel;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("platform", "android");
        result.put("version", VERSION);
        call.resolve(result);
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String key = requireString(call, "key");
        if (key == null) return;

        try {
            JSObject result = new JSObject();
            result.put("value", getSecurePreferences().getString(key, null));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Secure storage read failed.", error);
        }
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String key = requireString(call, "key");
        String value = requireString(call, "value");
        if (key == null || value == null) return;

        try {
            getSecurePreferences().edit().putString(key, value).apply();
            resolveOk(call);
        } catch (Exception error) {
            call.reject("Secure storage write failed.", error);
        }
    }

    @PluginMethod
    public void secureDelete(PluginCall call) {
        String key = requireString(call, "key");
        if (key == null) return;

        try {
            getSecurePreferences().edit().remove(key).apply();
            resolveOk(call);
        } catch (Exception error) {
            call.reject("Secure storage delete failed.", error);
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String rawUrl = requireString(call, "url");
        if (rawUrl == null) return;

        openExternalHttpUrl(call, rawUrl);
    }

    @PluginMethod
    public void termuxStatus(PluginCall call) {
        getTermuxCommandBridge().resolveStatus(call);
    }

    @PluginMethod
    public void requestTermuxRunCommandPermission(PluginCall call) {
        TermuxCommandBridge termuxBridge = getTermuxCommandBridge();
        if (!termuxBridge.isTermuxInstalled() || termuxBridge.hasRunCommandPermission()) {
            termuxBridge.resolveStatus(call);
            return;
        }

        requestPermissionForAlias("termuxRunCommand", call, "termuxRunCommandPermissionCallback");
    }

    @PermissionCallback
    private void termuxRunCommandPermissionCallback(PluginCall call) {
        getTermuxCommandBridge().resolveStatus(call);
    }

    @PluginMethod
    public void openTermuxInstallPage(PluginCall call) {
        getTermuxCommandBridge().openTermuxInstallPage(call);
    }

    @PluginMethod
    public void openTermuxApiInstallPage(PluginCall call) {
        getTermuxCommandBridge().openTermuxApiInstallPage(call);
    }

    @PluginMethod
    public void openTermuxApp(PluginCall call) {
        getTermuxCommandBridge().openTermuxApp(call);
    }

    @PluginMethod
    public void runTermuxCommand(PluginCall call) {
        getTermuxCommandBridge().runCommand(call);
    }

    @PluginMethod
    public void importMedia(PluginCall call) {
        String source = requireString(call, "source");
        String kind = call.getString("kind", "image");
        if (source == null) return;
        if (!kind.equals("image")) {
            call.reject("Only image media imports are supported.");
            return;
        }

        executor.submit(() -> {
            try {
                call.resolve(importImageMedia(source));
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Media import failed." : error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void startVoiceRecording(PluginCall call) {
        String requestId = requireString(call, "requestId");
        if (requestId == null) return;

        if (getPermissionState("recordAudio") != PermissionState.GRANTED) {
            requestPermissionForAlias("recordAudio", call, "recordAudioPermissionCallback");
            return;
        }

        startVoiceRecordingWithPermission(call, requestId);
    }

    @PermissionCallback
    private void recordAudioPermissionCallback(PluginCall call) {
        String requestId = requireString(call, "requestId");
        if (requestId == null) return;
        if (getPermissionState("recordAudio") != PermissionState.GRANTED) {
            call.reject("录音权限被拒绝。");
            return;
        }

        startVoiceRecordingWithPermission(call, requestId);
    }

    @PluginMethod
    public void stopVoiceRecording(PluginCall call) {
        String requestId = requireString(call, "requestId");
        if (requestId == null) return;

        ActiveVoiceRecording recording;
        synchronized (voiceLock) {
            recording = activeVoiceRecording;
            if (recording == null || !recording.requestId.equals(requestId)) {
                call.reject("没有正在进行的语音录音。");
                return;
            }
            activeVoiceRecording = null;
            recording.requestStop();
        }

        ActiveVoiceRecording finalRecording = recording;
        executor.submit(() -> {
            try {
                call.resolve(finishVoiceRecording(finalRecording));
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "语音识别失败。" : error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void cancelVoiceRecording(PluginCall call) {
        String requestId = requireString(call, "requestId");
        if (requestId == null) return;

        ActiveVoiceRecording recording = null;
        synchronized (voiceLock) {
            if (activeVoiceRecording != null && activeVoiceRecording.requestId.equals(requestId)) {
                recording = activeVoiceRecording;
                activeVoiceRecording = null;
            }
        }

        if (recording != null) {
            recording.requestStop();
        }
        resolveOk(call);
    }

    @PluginMethod
    public void appendDebugLog(PluginCall call) {
        String entry = requireString(call, "entry");
        if (entry == null) return;

        executor.submit(() -> {
            try {
                appendDebugLogLine(entry);
                resolveOk(call);
            } catch (Exception error) {
                call.reject("Debug log write failed.", error);
            }
        });
    }

    @PluginMethod
    public void getDebugLogInfo(PluginCall call) {
        executor.submit(() -> {
            try {
                call.resolve(buildDebugLogInfo());
            } catch (Exception error) {
                call.reject("Debug log info failed.", error);
            }
        });
    }

    @PluginMethod
    public void readDebugLogs(PluginCall call) {
        int maxBytes = Math.max(1024, call.getInt("maxBytes", DEBUG_LOG_DEFAULT_READ_BYTES));
        executor.submit(() -> {
            try {
                JSObject result = new JSObject();
                result.put("content", readDebugLogContent(maxBytes));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Debug log read failed.", error);
            }
        });
    }

    @PluginMethod
    public void clearDebugLogs(PluginCall call) {
        executor.submit(() -> {
            try {
                clearDebugLogFiles();
                resolveOk(call);
            } catch (Exception error) {
                call.reject("Debug log clear failed.", error);
            }
        });
    }

    @PluginMethod
    public void startChatCompletion(PluginCall call) {
        String requestId = requireString(call, "requestId");
        String url = requireString(call, "url");
        String body = call.getString("body", "{}");
        if (requestId == null || url == null) return;

        JSObject headers = call.getObject("headers", new JSObject());
        Future<?> future = executor.submit(() -> streamChatCompletion(requestId, url, headers, body));
        activeRequests.put(requestId, future);
        if (future.isDone()) {
            activeRequests.remove(requestId, future);
        }

        JSObject result = new JSObject();
        result.put("requestId", requestId);
        call.resolve(result);
    }

    @PluginMethod
    public void cancelChatCompletion(PluginCall call) {
        String requestId = requireString(call, "requestId");
        if (requestId == null) return;

        cancelRequest(requestId);
        resolveOk(call);
    }

    @Override
    protected void handleOnDestroy() {
        for (String requestId : activeRequests.keySet()) {
            cancelRequest(requestId);
        }
        activeRequests.clear();
        synchronized (voiceLock) {
            if (activeVoiceRecording != null) {
                activeVoiceRecording.requestStop();
                activeVoiceRecording = null;
            }
        }
        if (termuxCommandBridge != null) {
            termuxCommandBridge.destroy();
            termuxCommandBridge = null;
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private SharedPreferences getSecurePreferences() throws Exception {
        if (securePreferences != null) return securePreferences;

        Context context = getContext();
        MasterKey masterKey = new MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
        securePreferences = EncryptedSharedPreferences.create(
            context,
            SECURE_PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
        return securePreferences;
    }

    private JSObject importImageMedia(String rawSource) throws Exception {
        String source = rawSource.trim();
        MediaBytes mediaBytes = readMediaSource(source);
        String mimeType = resolveImageMimeType(mediaBytes.declaredMimeType, mediaBytes.bytes, source);
        String extension = extensionForMimeType(mimeType);
        String mediaId = "media_" + UUID.randomUUID().toString().replace("-", "");
        String fileName = mediaId + "." + extension;
        File mediaDir = new File(getContext().getFilesDir(), "morun-media");
        if (!mediaDir.exists() && !mediaDir.mkdirs()) {
            throw new IOException("Failed to create media storage.");
        }

        File target = new File(mediaDir, fileName);
        try (FileOutputStream output = new FileOutputStream(target)) {
            output.write(mediaBytes.bytes);
        }

        JSObject result = new JSObject();
        result.put("mediaId", mediaId);
        result.put("kind", "image");
        result.put("originalSource", source);
        result.put("localPath", target.getAbsolutePath());
        result.put("mimeType", mimeType);
        result.put("fileName", fileName);
        result.put("size", mediaBytes.bytes.length);
        result.put("createdAt", System.currentTimeMillis());
        return result;
    }

    @SuppressWarnings("MissingPermission")
    private void startVoiceRecordingWithPermission(PluginCall call, String requestId) {
        synchronized (voiceLock) {
            if (activeVoiceRecording != null) {
                call.reject("已有录音正在进行。");
                return;
            }

            int minBufferSize = AudioRecord.getMinBufferSize(
                VOICE_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            );
            if (minBufferSize <= 0) {
                call.reject("无法初始化录音设备。");
                return;
            }

            int bufferSize = Math.max(minBufferSize, VOICE_RECOGNIZER_CHUNK_BYTES);
            AudioRecord audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.MIC,
                VOICE_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            );
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                audioRecord.release();
                call.reject("无法初始化录音设备。");
                return;
            }

            try {
                audioRecord.startRecording();
            } catch (Exception error) {
                audioRecord.release();
                call.reject("无法开始录音。", error);
                return;
            }

            ActiveVoiceRecording recording = new ActiveVoiceRecording(requestId, safeVoiceId(requestId), audioRecord);
            recording.captureFuture = executor.submit(() -> captureVoice(recording, bufferSize));
            activeVoiceRecording = recording;

            JSObject result = new JSObject();
            result.put("requestId", requestId);
            result.put("startedAt", recording.createdAt);
            call.resolve(result);
        }
    }

    private void captureVoice(ActiveVoiceRecording recording, int bufferSize) {
        byte[] buffer = new byte[bufferSize];
        try {
            while (!recording.stopRequested && !Thread.currentThread().isInterrupted()) {
                if (recording.elapsedMs() >= VOICE_MAX_DURATION_MS) {
                    recording.limited = true;
                    break;
                }

                int read = recording.audioRecord.read(buffer, 0, buffer.length);
                if (read > 0) {
                    recording.write(buffer, read);
                } else if (read == AudioRecord.ERROR_INVALID_OPERATION || read == AudioRecord.ERROR_BAD_VALUE) {
                    break;
                }
            }
        } finally {
            try {
                if (recording.audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    recording.audioRecord.stop();
                }
            } catch (Exception ignored) {}
            recording.audioRecord.release();
        }
    }

    private JSObject finishVoiceRecording(ActiveVoiceRecording recording) throws Exception {
        Future<?> future = recording.captureFuture;
        if (future != null) {
            try {
                future.get(3, TimeUnit.SECONDS);
            } catch (Exception error) {
                future.cancel(true);
            }
        }

        byte[] pcm = recording.pcmBytes();
        long durationMs = durationMsForPcm(pcm);
        if (durationMs < VOICE_MIN_DURATION_MS || pcm.length < VOICE_SAMPLE_RATE) {
            throw new IllegalArgumentException("录音时间太短。");
        }

        File voiceDir = getVoiceDir();
        if (!voiceDir.exists() && !voiceDir.mkdirs()) {
            throw new IOException("无法创建语音文件目录。");
        }

        String fileName = recording.voiceId + ".wav";
        File wavFile = new File(voiceDir, fileName);
        writeVoiceWav(wavFile, pcm, VOICE_SAMPLE_RATE);

        long recognitionStartedAt = SystemClock.elapsedRealtime();
        VoiceRecognition recognition = recognizeVoicePcm(pcm);
        long recognitionElapsedMs = Math.max(1, SystemClock.elapsedRealtime() - recognitionStartedAt);
        String transcript = recognition.transcript.trim();
        if (transcript.isEmpty()) {
            throw new IllegalArgumentException("没有识别到语音内容。");
        }

        JSObject result = new JSObject();
        result.put("requestId", recording.requestId);
        result.put("voiceId", recording.voiceId);
        result.put("localPath", wavFile.getAbsolutePath());
        result.put("fileName", fileName);
        result.put("mimeType", VOICE_MIME_TYPE);
        result.put("size", wavFile.length());
        result.put("durationMs", durationMs);
        result.put("sampleRate", VOICE_SAMPLE_RATE);
        result.put("transcript", transcript);
        result.put("recognitionElapsedMs", recognitionElapsedMs);
        result.put("createdAt", recording.createdAt);
        result.put("limited", recording.limited);
        result.put("segments", recognition.segments);
        return result;
    }

    private VoiceRecognition recognizeVoicePcm(byte[] pcm) throws IOException {
        JSArray segments = new JSArray();
        StringBuilder transcript = new StringBuilder();

        try (Recognizer recognizer = new Recognizer(getVoskModel(), VOICE_SAMPLE_RATE)) {
            recognizer.setWords(false);
            int offset = 0;
            while (offset < pcm.length) {
                int size = Math.min(VOICE_RECOGNIZER_CHUNK_BYTES, pcm.length - offset);
                byte[] chunk = Arrays.copyOfRange(pcm, offset, offset + size);
                if (recognizer.acceptWaveForm(chunk, chunk.length)) {
                    appendVoiceSegment(segments, transcript, recognizer.getResult());
                }
                offset += size;
            }
            appendVoiceSegment(segments, transcript, recognizer.getFinalResult());
        }

        return new VoiceRecognition(transcript.toString().trim(), segments);
    }

    private synchronized Model getVoskModel() throws IOException {
        if (cachedVoskModel != null) return cachedVoskModel;

        try {
            String modelPath = StorageService.sync(getContext(), VOSK_MODEL_ASSET, VOSK_MODEL_STORAGE_DIR);
            cachedVoskModel = new Model(modelPath);
            return cachedVoskModel;
        } catch (IOException error) {
            throw new IOException("Vosk 中文模型缺失或加载失败。请确认 APK 已打包 model-zh-cn 资产。", error);
        }
    }

    private static void appendVoiceSegment(JSArray segments, StringBuilder transcript, String rawJson) {
        String text = extractText(rawJson);
        if (text.isEmpty()) return;

        if (transcript.length() > 0) transcript.append(' ');
        transcript.append(text);

        JSObject segment = new JSObject();
        segment.put("text", text);
        segment.put("raw", rawJson);
        segments.put(segment);
    }

    private static String extractText(String rawJson) {
        try {
            JSONObject json = new JSONObject(rawJson);
            return json.optString("text", "").trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    private static long durationMsForPcm(byte[] pcm) {
        return Math.round((pcm.length / (VOICE_SAMPLE_RATE * 2.0)) * 1000.0);
    }

    private File getVoiceDir() {
        return new File(getContext().getFilesDir(), VOICE_DIR_NAME);
    }

    private static String safeVoiceId(String requestId) {
        String cleaned = requestId == null ? "" : requestId.trim();
        if (cleaned.matches("voice_[A-Za-z0-9_-]{6,80}")) {
            return cleaned;
        }
        return "voice_" + UUID.randomUUID().toString().replace("-", "");
    }

    private static void writeVoiceWav(File file, byte[] pcm, int sampleRate) throws IOException {
        int byteRate = sampleRate * 2;
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(new byte[] { 'R', 'I', 'F', 'F' });
            writeLittleEndianInt(output, 36 + pcm.length);
            output.write(new byte[] { 'W', 'A', 'V', 'E' });
            output.write(new byte[] { 'f', 'm', 't', ' ' });
            writeLittleEndianInt(output, 16);
            writeLittleEndianShort(output, 1);
            writeLittleEndianShort(output, 1);
            writeLittleEndianInt(output, sampleRate);
            writeLittleEndianInt(output, byteRate);
            writeLittleEndianShort(output, 2);
            writeLittleEndianShort(output, 16);
            output.write(new byte[] { 'd', 'a', 't', 'a' });
            writeLittleEndianInt(output, pcm.length);
            output.write(pcm);
        }
    }

    private static void writeLittleEndianShort(FileOutputStream output, int value) throws IOException {
        output.write(value & 0xff);
        output.write((value >> 8) & 0xff);
    }

    private static void writeLittleEndianInt(FileOutputStream output, int value) throws IOException {
        output.write(value & 0xff);
        output.write((value >> 8) & 0xff);
        output.write((value >> 16) & 0xff);
        output.write((value >> 24) & 0xff);
    }

    private MediaBytes readMediaSource(String source) throws Exception {
        if (source.startsWith("data:image/")) {
            return readDataImage(source);
        }
        if (source.startsWith("content://")) {
            Uri uri = Uri.parse(source);
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IOException("Cannot open content URI.");
                return new MediaBytes(readBytesLimited(input), getContext().getContentResolver().getType(uri));
            }
        }
        if (source.startsWith("https://")) {
            return readHttpsImage(source);
        }

        String path = sourceToPath(source);
        if (path.startsWith(TERMUX_HOME_PREFIX)) {
            String base64 = getTermuxCommandBridge().readHomeFileAsBase64(path, MAX_IMAGE_MEDIA_BYTES);
            try {
                return new MediaBytes(Base64.decode(base64, Base64.NO_WRAP), declaredMimeTypeFromPath(path));
            } catch (IllegalArgumentException error) {
                throw new IllegalArgumentException("Invalid image data returned from Termux.");
            }
        }

        if (isMorunReadablePath(path)) {
            try (InputStream input = new FileInputStream(new File(path))) {
                return new MediaBytes(readBytesLimited(input), declaredMimeTypeFromPath(path));
            }
        }

        throw new IllegalArgumentException("Unsupported or unreadable image source.");
    }

    private MediaBytes readDataImage(String source) throws IOException {
        int commaIndex = source.indexOf(',');
        if (commaIndex <= 0) throw new IllegalArgumentException("Invalid data image.");
        String header = source.substring(0, commaIndex).toLowerCase(Locale.ROOT);
        if (!header.endsWith(";base64")) throw new IllegalArgumentException("Only base64 data images are supported.");
        String mimeType = header.substring("data:".length(), header.length() - ";base64".length());
        byte[] bytes = Base64.decode(source.substring(commaIndex + 1), Base64.DEFAULT);
        if (bytes.length > MAX_IMAGE_MEDIA_BYTES) throw new IllegalArgumentException("Image is too large.");
        return new MediaBytes(bytes, mimeType);
    }

    private MediaBytes readHttpsImage(String source) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(true);

        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("Image download failed.");
            }
            int contentLength = connection.getContentLength();
            if (contentLength > MAX_IMAGE_MEDIA_BYTES) throw new IllegalArgumentException("Image is too large.");
            try (InputStream input = connection.getInputStream()) {
                return new MediaBytes(readBytesLimited(input), connection.getContentType());
            }
        } finally {
            connection.disconnect();
        }
    }

    private byte[] readBytesLimited(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        int total = 0;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > MAX_IMAGE_MEDIA_BYTES) {
                throw new IllegalArgumentException("Image is too large.");
            }
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private String resolveImageMimeType(String declaredMimeType, byte[] bytes, String source) {
        String sniffed = sniffImageMimeType(bytes);
        String declared = cleanMimeType(declaredMimeType);
        String pathDeclared = declaredMimeTypeFromPath(source);
        String mimeType = sniffed != null ? sniffed : declared != null ? declared : pathDeclared;
        if (
            mimeType == null ||
            (!mimeType.equals("image/jpeg") && !mimeType.equals("image/png") && !mimeType.equals("image/webp") && !mimeType.equals("image/gif"))
        ) {
            throw new IllegalArgumentException("Unsupported image type.");
        }
        return mimeType;
    }

    private String sniffImageMimeType(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff) {
            return "image/jpeg";
        }
        if (
            bytes.length >= 8 &&
            (bytes[0] & 0xff) == 0x89 &&
            bytes[1] == 0x50 &&
            bytes[2] == 0x4e &&
            bytes[3] == 0x47
        ) {
            return "image/png";
        }
        if (bytes.length >= 6 && bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46) {
            return "image/gif";
        }
        if (
            bytes.length >= 12 &&
            bytes[0] == 0x52 &&
            bytes[1] == 0x49 &&
            bytes[2] == 0x46 &&
            bytes[3] == 0x46 &&
            bytes[8] == 0x57 &&
            bytes[9] == 0x45 &&
            bytes[10] == 0x42 &&
            bytes[11] == 0x50
        ) {
            return "image/webp";
        }
        return null;
    }

    private String declaredMimeTypeFromPath(String value) {
        String clean = value == null ? "" : value.split("[?#]", 2)[0].toLowerCase(Locale.ROOT);
        if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
        if (clean.endsWith(".png")) return "image/png";
        if (clean.endsWith(".webp")) return "image/webp";
        if (clean.endsWith(".gif")) return "image/gif";
        return null;
    }

    private String extensionForMimeType(String mimeType) {
        if (mimeType.equals("image/jpeg")) return "jpg";
        if (mimeType.equals("image/png")) return "png";
        if (mimeType.equals("image/webp")) return "webp";
        return "gif";
    }

    private String cleanMimeType(String value) {
        if (value == null) return null;
        return value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    }

    private String sourceToPath(String source) {
        if (source.startsWith("file://")) {
            return Uri.parse(source).getPath();
        }
        return source;
    }

    private boolean isMorunReadablePath(String path) throws IOException {
        if (path == null || path.indexOf('\0') >= 0) return false;
        File file = new File(path).getCanonicalFile();
        if (path.split("/").length > 0 && path.contains("/../")) return false;
        if (!file.isFile()) return false;

        File filesDir = getContext().getFilesDir().getCanonicalFile();
        File cacheDir = getContext().getCacheDir().getCanonicalFile();
        File externalFilesDir = getContext().getExternalFilesDir(null);
        return isInside(file, filesDir) ||
            isInside(file, cacheDir) ||
            (externalFilesDir != null && isInside(file, externalFilesDir.getCanonicalFile()));
    }

    private boolean isInside(File file, File directory) throws IOException {
        String filePath = file.getCanonicalPath();
        String dirPath = directory.getCanonicalPath();
        return filePath.equals(dirPath) || filePath.startsWith(dirPath + File.separator);
    }

    private void streamChatCompletion(String requestId, String url, JSObject headers, String body) {
        HttpURLConnection connection = null;

        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            activeConnections.put(requestId, connection);
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(0);
            connection.setDoOutput(true);
            applyHeaders(connection, headers);

            try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(connection.getOutputStream(), StandardCharsets.UTF_8))) {
                writer.write(body == null ? "{}" : body);
            }

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                notifyError(requestId, readStream(connection.getErrorStream()), status);
                notifyDone(requestId);
                return;
            }

            try (
                BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8)
                )
            ) {
                String line;
                while ((line = reader.readLine()) != null && !Thread.currentThread().isInterrupted()) {
                    String data = parseSseData(line);
                    if (data == null) continue;

                    notifyDelta(requestId, data);
                    if (data.equals("[DONE]")) {
                        break;
                    }
                }
            }

            notifyDone(requestId);
        } catch (IOException error) {
            if (!Thread.currentThread().isInterrupted()) {
                notifyError(requestId, error.getMessage(), null);
                notifyDone(requestId);
            }
        } finally {
            activeConnections.remove(requestId);
            activeRequests.remove(requestId);
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void applyHeaders(HttpURLConnection connection, JSObject headers) {
        if (headers == null || !headers.keys().hasNext()) {
            connection.setRequestProperty("Content-Type", "application/json");
            return;
        }

        boolean hasContentType = false;
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headers.getString(key);
            if (value == null) continue;

            connection.setRequestProperty(key, value);
            if (key.equalsIgnoreCase("Content-Type")) {
                hasContentType = true;
            }
        }

        if (!hasContentType) {
            connection.setRequestProperty("Content-Type", "application/json");
        }
    }

    private String parseSseData(String line) {
        String trimmed = line == null ? "" : line.trim();
        if (!trimmed.startsWith("data:")) return null;
        return trimmed.substring(5).trim();
    }

    private synchronized void appendDebugLogLine(String entry) throws IOException {
        File dir = getDebugLogDir();
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Unable to create debug log directory.");
        }

        File current = new File(dir, DEBUG_LOG_FILE_NAME);
        if (current.exists() && current.length() >= DEBUG_LOG_MAX_FILE_BYTES) {
            rotateDebugLogs(dir);
        }

        String line = normalizeDebugLogLine(entry);
        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(current, true), StandardCharsets.UTF_8))) {
            writer.write(line);
            writer.newLine();
        }

        Log.i(DEBUG_LOG_TAG, debugLogSummary(line));
    }

    private JSObject buildDebugLogInfo() throws IOException {
        File dir = getDebugLogDir();
        File[] files = listDebugLogFiles(dir);
        long totalBytes = 0;
        long latestModifiedAt = 0;
        JSArray fileItems = new JSArray();

        for (File file : files) {
            long size = file.length();
            long lastModified = file.lastModified();
            totalBytes += size;
            latestModifiedAt = Math.max(latestModifiedAt, lastModified);

            JSObject item = new JSObject();
            item.put("name", file.getName());
            item.put("size", size);
            item.put("lastModified", lastModified);
            fileItems.put(item);
        }

        JSObject result = new JSObject();
        result.put("enabled", true);
        result.put("directory", dir.getCanonicalPath());
        result.put("totalBytes", totalBytes);
        if (latestModifiedAt > 0) {
            result.put("latestModifiedAt", latestModifiedAt);
        }
        result.put("files", fileItems);
        return result;
    }

    private String readDebugLogContent(int maxBytes) throws IOException {
        File[] files = listDebugLogFilesForReading(getDebugLogDir());
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];

        for (File file : files) {
            try (FileInputStream input = new FileInputStream(file)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    trimDebugLogBuffer(output, maxBytes);
                }
            }
        }

        return output.toString(StandardCharsets.UTF_8.name());
    }

    private void clearDebugLogFiles() throws IOException {
        File dir = getDebugLogDir();
        for (File file : listDebugLogFiles(dir)) {
            if (file.exists() && !file.delete()) {
                throw new IOException("Unable to delete debug log file: " + file.getName());
            }
        }
    }

    private File getDebugLogDir() {
        return new File(getContext().getFilesDir(), DEBUG_LOG_DIR_NAME);
    }

    private void rotateDebugLogs(File dir) {
        File oldest = new File(dir, debugLogFileName(DEBUG_LOG_MAX_FILES - 1));
        if (oldest.exists()) {
            oldest.delete();
        }

        for (int index = DEBUG_LOG_MAX_FILES - 2; index >= 1; index -= 1) {
            File source = new File(dir, debugLogFileName(index));
            if (source.exists()) {
                source.renameTo(new File(dir, debugLogFileName(index + 1)));
            }
        }

        File current = new File(dir, DEBUG_LOG_FILE_NAME);
        if (current.exists()) {
            current.renameTo(new File(dir, debugLogFileName(1)));
        }
    }

    private File[] listDebugLogFiles(File dir) {
        File[] files = dir.listFiles((file, name) -> name.startsWith("events") && name.endsWith(".jsonl"));
        if (files == null) return new File[] {};

        Arrays.sort(files, Comparator.comparing(File::getName));
        return files;
    }

    private File[] listDebugLogFilesForReading(File dir) {
        File[] files = listDebugLogFiles(dir);
        Arrays.sort(files, (left, right) -> Integer.compare(debugLogAge(right), debugLogAge(left)));
        return files;
    }

    private int debugLogAge(File file) {
        String name = file.getName();
        if (DEBUG_LOG_FILE_NAME.equals(name)) return 0;
        if (!name.startsWith("events.") || !name.endsWith(".jsonl")) return 0;

        try {
            return Integer.parseInt(name.substring("events.".length(), name.length() - ".jsonl".length()));
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    private String debugLogFileName(int index) {
        return "events." + index + ".jsonl";
    }

    private void trimDebugLogBuffer(ByteArrayOutputStream output, int maxBytes) throws IOException {
        if (output.size() <= maxBytes) return;

        byte[] bytes = output.toByteArray();
        output.reset();
        output.write(bytes, bytes.length - maxBytes, maxBytes);
    }

    private String normalizeDebugLogLine(String entry) {
        return entry.trim().replace('\r', ' ').replace('\n', ' ');
    }

    private String debugLogSummary(String line) {
        try {
            JSONObject entry = new JSONObject(line);
            StringBuilder summary = new StringBuilder();
            summary
                .append(entry.optString("level", "info"))
                .append(' ')
                .append(entry.optString("category", "app"))
                .append('.')
                .append(entry.optString("event", "unknown"));

            String sessionId = entry.optString("sessionId", "");
            String runId = entry.optString("runId", "");
            if (!sessionId.isEmpty()) summary.append(" session=").append(shortDebugValue(sessionId));
            if (!runId.isEmpty()) summary.append(" run=").append(shortDebugValue(runId));

            JSONObject data = entry.optJSONObject("data");
            if (data != null) {
                appendSummaryField(summary, data, "toolName", " tool=");
                appendSummaryField(summary, data, "status", " status=");
                appendSummaryField(summary, data, "durationMs", " durationMs=");
                appendSummaryField(summary, data, "error", " error=");
            }

            return shortDebugValue(summary.toString(), 360);
        } catch (Exception error) {
            return shortDebugValue("debug_log malformed_entry", 360);
        }
    }

    private void appendSummaryField(StringBuilder summary, JSONObject data, String key, String label) {
        String value = data.optString(key, "");
        if (!value.isEmpty()) {
            summary.append(label).append(shortDebugValue(value));
        }
    }

    private String shortDebugValue(String value) {
        return shortDebugValue(value, 80);
    }

    private String shortDebugValue(String value, int maxLength) {
        String normalized = value == null ? "" : value.replaceAll("\\s+", " ").trim();
        if (normalized.length() <= maxLength) return normalized;
        return normalized.substring(0, maxLength) + "...";
    }

    private String readStream(InputStream stream) throws IOException {
        if (stream == null) return "";

        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (builder.length() > 0) builder.append('\n');
                builder.append(line);
                if (builder.length() > 4000) break;
            }
        }

        return builder.toString();
    }

    private void cancelRequest(String requestId) {
        HttpURLConnection connection = activeConnections.remove(requestId);
        if (connection != null) {
            connection.disconnect();
        }

        Future<?> future = activeRequests.remove(requestId);
        if (future != null) {
            future.cancel(true);
        }
    }

    private void notifyDelta(String requestId, String data) {
        JSObject event = new JSObject();
        event.put("requestId", requestId);
        event.put("data", data);
        notifyListeners("chatCompletionDelta", event);
    }

    private void notifyError(String requestId, String message, Integer status) {
        JSObject event = new JSObject();
        event.put("requestId", requestId);
        event.put("message", message == null || message.trim().isEmpty() ? "Native HTTP request failed." : message);
        if (status != null) {
            event.put("status", status);
        }
        notifyListeners("chatCompletionError", event);
    }

    private void notifyDone(String requestId) {
        JSObject event = new JSObject();
        event.put("requestId", requestId);
        notifyListeners("chatCompletionDone", event);
    }

    private void openExternalHttpUrl(PluginCall call, String rawUrl) {
        Uri uri = Uri.parse(rawUrl);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            call.reject("Only http and https URLs are allowed.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("No app can open this URL.");
            return;
        }

        getContext().startActivity(intent);
        resolveOk(call);
    }

    private TermuxCommandBridge getTermuxCommandBridge() {
        if (termuxCommandBridge == null) {
            termuxCommandBridge = new TermuxCommandBridge(getContext());
        }
        return termuxCommandBridge;
    }

    private String requireString(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null || value.trim().isEmpty()) {
            call.reject("Must provide " + key + ".");
            return null;
        }
        return value;
    }

    private void resolveOk(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    private static class ActiveVoiceRecording {
        final String requestId;
        final String voiceId;
        final AudioRecord audioRecord;
        final long startedAtElapsed;
        final long createdAt;
        final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
        volatile boolean stopRequested;
        volatile boolean limited;
        Future<?> captureFuture;

        ActiveVoiceRecording(String requestId, String voiceId, AudioRecord audioRecord) {
            this.requestId = requestId;
            this.voiceId = voiceId;
            this.audioRecord = audioRecord;
            this.startedAtElapsed = SystemClock.elapsedRealtime();
            this.createdAt = System.currentTimeMillis();
        }

        long elapsedMs() {
            return SystemClock.elapsedRealtime() - startedAtElapsed;
        }

        synchronized void write(byte[] buffer, int length) {
            pcm.write(buffer, 0, length);
        }

        synchronized byte[] pcmBytes() {
            return pcm.toByteArray();
        }

        void requestStop() {
            stopRequested = true;
            try {
                if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    audioRecord.stop();
                }
            } catch (Exception ignored) {}
        }
    }

    private static class VoiceRecognition {
        final String transcript;
        final JSArray segments;

        VoiceRecognition(String transcript, JSArray segments) {
            this.transcript = transcript;
            this.segments = segments;
        }
    }

    private static class MediaBytes {
        final byte[] bytes;
        final String declaredMimeType;

        MediaBytes(byte[] bytes, String declaredMimeType) {
            this.bytes = bytes;
            this.declaredMimeType = declaredMimeType;
        }
    }
}
