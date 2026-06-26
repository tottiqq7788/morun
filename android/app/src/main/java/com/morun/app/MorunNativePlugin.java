package com.morun.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.BufferedWriter;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

@CapacitorPlugin(name = "MorunNative")
public class MorunNativePlugin extends Plugin {

    private static final String SECURE_PREFS_NAME = "morun_secure_store";
    private static final String VERSION = "0.4.0";

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();
    private final Map<String, Future<?>> activeRequests = new ConcurrentHashMap<>();
    private SharedPreferences securePreferences;

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

        Uri uri = Uri.parse(rawUrl);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            call.reject("Only http and https URLs are allowed.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("No app can open this URL.");
            return;
        }

        getContext().startActivity(intent);
        resolveOk(call);
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
}
