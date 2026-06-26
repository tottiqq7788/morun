package com.morun.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "MorunNative",
    permissions = { @Permission(alias = "termuxRunCommand", strings = { "com.termux.permission.RUN_COMMAND" }) }
)
public class MorunNativePlugin extends Plugin {

    private static final String SECURE_PREFS_NAME = "morun_secure_store";
    private static final String VERSION = "0.4.0";
    private static final String TERMUX_PACKAGE_NAME = "com.termux";
    private static final String TERMUX_API_PACKAGE_NAME = "com.termux.api";
    private static final String TERMUX_RELEASES_URL = "https://github.com/termux/termux-app/releases";
    private static final String TERMUX_API_RELEASES_URL = "https://github.com/termux/termux-api/releases";
    private static final String TERMUX_RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND";
    private static final String TERMUX_RUN_COMMAND_ACTION = "com.termux.RUN_COMMAND";
    private static final String TERMUX_RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService";
    private static final String TERMUX_BIN_DIR = "/data/data/com.termux/files/usr/bin/";
    private static final String TERMUX_RESULT_ACTION = "com.morun.app.TERMUX_COMMAND_RESULT";
    private static final String EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH";
    private static final String EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS";
    private static final String EXTRA_STDIN = "com.termux.RUN_COMMAND_STDIN";
    private static final String EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR";
    private static final String EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND";
    private static final String EXTRA_RUNNER = "com.termux.RUN_COMMAND_RUNNER";
    private static final String EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT";
    private static final String EXTRA_COMMAND_LABEL = "com.termux.RUN_COMMAND_COMMAND_LABEL";
    private static final String EXTRA_PLUGIN_RESULT_BUNDLE = "result";
    private static final String EXTRA_PLUGIN_RESULT_STDOUT = "stdout";
    private static final String EXTRA_PLUGIN_RESULT_STDERR = "stderr";
    private static final String EXTRA_PLUGIN_RESULT_EXIT_CODE = "exitCode";
    private static final String EXTRA_PLUGIN_RESULT_ERR = "err";
    private static final String EXTRA_PLUGIN_RESULT_ERRMSG = "errmsg";
    private static final Set<String> TERMUX_COMMAND_ALLOWLIST = new HashSet<>(
        Arrays.asList(
            "termux-audio-info",
            "termux-battery-status",
            "termux-call-log",
            "termux-camera-info",
            "termux-camera-photo",
            "termux-clipboard-get",
            "termux-clipboard-set",
            "termux-contact-list",
            "termux-location",
            "termux-microphone-record",
            "termux-notification",
            "termux-sms-list",
            "termux-toast",
            "termux-tts-speak",
            "termux-vibrate"
        )
    );

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();
    private final Map<String, Future<?>> activeRequests = new ConcurrentHashMap<>();
    private final Map<String, PendingTermuxCommand> activeTermuxCommands = new ConcurrentHashMap<>();
    private final BroadcastReceiver termuxResultReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            handleTermuxResult(intent);
        }
    };
    private boolean termuxResultReceiverRegistered = false;
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

        openExternalHttpUrl(call, rawUrl);
    }

    @PluginMethod
    public void termuxStatus(PluginCall call) {
        resolveTermuxStatus(call);
    }

    @PluginMethod
    public void requestTermuxRunCommandPermission(PluginCall call) {
        if (!isPackageInstalled(TERMUX_PACKAGE_NAME) || hasRunCommandPermission()) {
            resolveTermuxStatus(call);
            return;
        }

        requestPermissionForAlias("termuxRunCommand", call, "termuxRunCommandPermissionCallback");
    }

    @PermissionCallback
    private void termuxRunCommandPermissionCallback(PluginCall call) {
        resolveTermuxStatus(call);
    }

    @PluginMethod
    public void openTermuxInstallPage(PluginCall call) {
        openExternalHttpUrl(call, TERMUX_RELEASES_URL);
    }

    @PluginMethod
    public void openTermuxApiInstallPage(PluginCall call) {
        openExternalHttpUrl(call, TERMUX_API_RELEASES_URL);
    }

    @PluginMethod
    public void openTermuxApp(PluginCall call) {
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE_NAME);
        if (intent == null) {
            call.reject("Termux is not installed.");
            return;
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        resolveOk(call);
    }

    @PluginMethod
    public void runTermuxCommand(PluginCall call) {
        String requestId = requireString(call, "requestId");
        String command = requireString(call, "command");
        if (requestId == null || command == null) return;

        if (!TERMUX_COMMAND_ALLOWLIST.contains(command)) {
            call.reject("Termux command is not allowlisted.");
            return;
        }

        if (!isPackageInstalled(TERMUX_PACKAGE_NAME)) {
            resolveTermuxUnavailable(call, requestId, "Termux is not installed.");
            return;
        }

        if (!hasRunCommandPermission()) {
            resolveTermuxUnavailable(call, requestId, "RUN_COMMAND permission is not granted.");
            return;
        }

        String[] args = parseStringArray(call, "args");
        if (args == null) return;

        ensureTermuxResultReceiverRegistered();

        int timeoutMs = clamp(call.getInt("timeoutMs", 20000), 1000, 120000);
        Intent resultIntent = new Intent(TERMUX_RESULT_ACTION);
        resultIntent.setPackage(getContext().getPackageName());
        resultIntent.putExtra("requestId", requestId);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            getContext(),
            requestId.hashCode() & 0x7fffffff,
            resultIntent,
            flags
        );

        Intent intent = new Intent(TERMUX_RUN_COMMAND_ACTION);
        intent.setClassName(TERMUX_PACKAGE_NAME, TERMUX_RUN_COMMAND_SERVICE);
        intent.putExtra(EXTRA_COMMAND_PATH, TERMUX_BIN_DIR + command);
        intent.putExtra(EXTRA_ARGUMENTS, args);
        intent.putExtra(EXTRA_BACKGROUND, true);
        intent.putExtra(EXTRA_RUNNER, "app-shell");
        intent.putExtra(EXTRA_COMMAND_LABEL, "morun " + command);
        intent.putExtra(EXTRA_PENDING_INTENT, pendingIntent);

        String stdin = call.getString("stdin");
        if (stdin != null) {
            intent.putExtra(EXTRA_STDIN, stdin);
        }

        String workdir = call.getString("workdir");
        if (workdir != null && !workdir.trim().isEmpty()) {
            intent.putExtra(EXTRA_WORKDIR, workdir.trim());
        }

        PendingTermuxCommand pending = new PendingTermuxCommand(call, requestId);
        pending.timeoutRunnable = () -> {
            PendingTermuxCommand removed = activeTermuxCommands.remove(requestId);
            if (removed != null) {
                resolveTermuxCommandResult(removed.call, requestId, true, "", "", null, true, null, "Termux command timed out.");
            }
        };
        activeTermuxCommands.put(requestId, pending);
        mainHandler.postDelayed(pending.timeoutRunnable, timeoutMs);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (SecurityException error) {
            activeTermuxCommands.remove(requestId);
            mainHandler.removeCallbacks(pending.timeoutRunnable);
            resolveTermuxUnavailable(call, requestId, "RUN_COMMAND permission is not granted.");
        } catch (Exception error) {
            activeTermuxCommands.remove(requestId);
            mainHandler.removeCallbacks(pending.timeoutRunnable);
            resolveTermuxUnavailable(call, requestId, error.getMessage() == null ? "Failed to start Termux command." : error.getMessage());
        }
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
        for (PendingTermuxCommand pending : activeTermuxCommands.values()) {
            if (pending.timeoutRunnable != null) {
                mainHandler.removeCallbacks(pending.timeoutRunnable);
            }
        }
        activeTermuxCommands.clear();
        if (termuxResultReceiverRegistered) {
            try {
                getContext().unregisterReceiver(termuxResultReceiver);
            } catch (Exception ignored) {
                // The receiver may already be gone if Android is tearing down the process.
            }
            termuxResultReceiverRegistered = false;
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

    private boolean isPackageInstalled(String packageName) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().getPackageManager().getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0));
            } else {
                getContext().getPackageManager().getPackageInfo(packageName, 0);
            }
            return true;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    private boolean hasRunCommandPermission() {
        return getContext().checkSelfPermission(TERMUX_RUN_COMMAND_PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }

    private void resolveTermuxStatus(PluginCall call) {
        boolean termuxInstalled = isPackageInstalled(TERMUX_PACKAGE_NAME);
        boolean termuxApiInstalled = isPackageInstalled(TERMUX_API_PACKAGE_NAME);
        boolean runCommandPermissionGranted = hasRunCommandPermission();
        boolean canRunCommands = termuxInstalled && runCommandPermissionGranted;

        JSObject result = new JSObject();
        result.put("available", canRunCommands);
        result.put("termuxInstalled", termuxInstalled);
        result.put("termuxApiInstalled", termuxApiInstalled);
        result.put("runCommandPermissionGranted", runCommandPermissionGranted);
        result.put("canRunCommands", canRunCommands);
        result.put("message", termuxStatusMessage(termuxInstalled, termuxApiInstalled, runCommandPermissionGranted));
        call.resolve(result);
    }

    private String termuxStatusMessage(boolean termuxInstalled, boolean termuxApiInstalled, boolean runCommandPermissionGranted) {
        if (!termuxInstalled) return "Termux is not installed.";
        if (!runCommandPermissionGranted) return "RUN_COMMAND permission is not granted.";
        if (!termuxApiInstalled) return "Termux:API app is not installed.";
        return "Termux bridge is ready for diagnostics.";
    }

    private synchronized void ensureTermuxResultReceiverRegistered() {
        if (termuxResultReceiverRegistered) return;

        IntentFilter filter = new IntentFilter(TERMUX_RESULT_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(termuxResultReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(termuxResultReceiver, filter);
        }
        termuxResultReceiverRegistered = true;
    }

    private void handleTermuxResult(Intent intent) {
        if (intent == null) return;

        String requestId = intent.getStringExtra("requestId");
        if (requestId == null) return;

        PendingTermuxCommand pending = activeTermuxCommands.remove(requestId);
        if (pending == null) return;
        if (pending.timeoutRunnable != null) {
            mainHandler.removeCallbacks(pending.timeoutRunnable);
        }

        Bundle bundle = intent.getBundleExtra(EXTRA_PLUGIN_RESULT_BUNDLE);
        String stdout = bundle == null ? "" : bundle.getString(EXTRA_PLUGIN_RESULT_STDOUT, "");
        String stderr = bundle == null ? "" : bundle.getString(EXTRA_PLUGIN_RESULT_STDERR, "");
        Integer exitCode = bundle != null && bundle.containsKey(EXTRA_PLUGIN_RESULT_EXIT_CODE)
            ? bundle.getInt(EXTRA_PLUGIN_RESULT_EXIT_CODE)
            : null;
        Integer errCode = bundle != null && bundle.containsKey(EXTRA_PLUGIN_RESULT_ERR) ? bundle.getInt(EXTRA_PLUGIN_RESULT_ERR) : null;
        String errmsg = bundle == null ? null : bundle.getString(EXTRA_PLUGIN_RESULT_ERRMSG, null);

        resolveTermuxCommandResult(pending.call, requestId, true, stdout, stderr, exitCode, false, errCode, errmsg);
    }

    private String[] parseStringArray(PluginCall call, String key) {
        JSArray values = call.getArray(key, new JSArray());
        String[] parsed = new String[values.length()];

        for (int i = 0; i < values.length(); i++) {
            try {
                Object value = values.get(i);
                if (!(value instanceof String)) {
                    call.reject(key + " must only contain strings.");
                    return null;
                }
                parsed[i] = (String) value;
            } catch (JSONException error) {
                call.reject("Invalid " + key + ".");
                return null;
            }
        }

        return parsed;
    }

    private void resolveTermuxUnavailable(PluginCall call, String requestId, String message) {
        resolveTermuxCommandResult(call, requestId, false, "", message, null, false, null, message);
    }

    private void resolveTermuxCommandResult(
        PluginCall call,
        String requestId,
        boolean available,
        String stdout,
        String stderr,
        Integer exitCode,
        boolean timedOut,
        Integer errCode,
        String errmsg
    ) {
        JSObject result = new JSObject();
        result.put("requestId", requestId);
        result.put("available", available);
        result.put("stdout", stdout == null ? "" : stdout);
        result.put("stderr", stderr == null ? "" : stderr);
        result.put("exitCode", exitCode == null ? JSONObject.NULL : exitCode);
        result.put("timedOut", timedOut);
        if (errCode != null) {
            result.put("errCode", errCode);
        }
        if (errmsg != null) {
            result.put("errmsg", errmsg);
        }
        call.resolve(result);
    }

    private int clamp(Integer value, int min, int max) {
        int resolved = value == null ? min : value;
        return Math.min(max, Math.max(min, resolved));
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

    private static class PendingTermuxCommand {
        final PluginCall call;
        final String requestId;
        Runnable timeoutRunnable;

        PendingTermuxCommand(PluginCall call, String requestId) {
            this.call = call;
            this.requestId = requestId;
        }
    }
}
