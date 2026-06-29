package com.morun.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
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
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

@CapacitorPlugin(
    name = "MorunNative",
    permissions = { @Permission(alias = "termuxRunCommand", strings = { "com.termux.permission.RUN_COMMAND" }) }
)
public class MorunNativePlugin extends Plugin {

    private static final String SECURE_PREFS_NAME = "morun_secure_store";
    private static final String VERSION = "0.5.1";
    private static final String TERMUX_HOME_PREFIX = "/data/data/com.termux/files/home/";
    private static final int MAX_IMAGE_MEDIA_BYTES = 12 * 1024 * 1024;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();
    private final Map<String, Future<?>> activeRequests = new ConcurrentHashMap<>();
    private SharedPreferences securePreferences;
    private TermuxCommandBridge termuxCommandBridge;

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

    private static class MediaBytes {
        final byte[] bytes;
        final String declaredMimeType;

        MediaBytes(byte[] bytes, String declaredMimeType) {
            this.bytes = bytes;
            this.declaredMimeType = declaredMimeType;
        }
    }
}
