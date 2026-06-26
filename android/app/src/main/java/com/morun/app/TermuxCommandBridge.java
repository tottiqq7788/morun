package com.morun.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONException;
import org.json.JSONObject;

public class TermuxCommandBridge {

    static final String TERMUX_PACKAGE_NAME = "com.termux";
    static final String TERMUX_RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND";

    private static final String TERMUX_API_PACKAGE_NAME = "com.termux.api";
    private static final String TERMUX_RELEASES_URL = "https://github.com/termux/termux-app/releases";
    private static final String TERMUX_API_RELEASES_URL = "https://github.com/termux/termux-api/releases";
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

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, PendingTermuxCommand> activeCommands = new ConcurrentHashMap<>();
    private final BroadcastReceiver resultReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context receiverContext, Intent intent) {
            handleResult(intent);
        }
    };
    private boolean resultReceiverRegistered = false;

    public TermuxCommandBridge(Context context) {
        this.context = context;
    }

    public boolean isTermuxInstalled() {
        return isPackageInstalled(TERMUX_PACKAGE_NAME);
    }

    public boolean hasRunCommandPermission() {
        return context.checkSelfPermission(TERMUX_RUN_COMMAND_PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }

    public void resolveStatus(PluginCall call) {
        call.resolve(createStatus());
    }

    public void openTermuxInstallPage(PluginCall call) {
        openExternalHttpUrl(call, TERMUX_RELEASES_URL);
    }

    public void openTermuxApiInstallPage(PluginCall call) {
        openExternalHttpUrl(call, TERMUX_API_RELEASES_URL);
    }

    public void openTermuxApp(PluginCall call) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE_NAME);
        if (intent == null) {
            call.reject("Termux is not installed.");
            return;
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        resolveOk(call);
    }

    public void runCommand(PluginCall call) {
        String requestId = requireString(call, "requestId");
        String command = requireString(call, "command");
        if (requestId == null || command == null) return;

        if (!TERMUX_COMMAND_ALLOWLIST.contains(command)) {
            call.reject("Termux command is not allowlisted.");
            return;
        }

        if (!isTermuxInstalled()) {
            resolveUnavailable(call, requestId, "Termux is not installed.");
            return;
        }

        if (!hasRunCommandPermission()) {
            resolveUnavailable(call, requestId, "RUN_COMMAND permission is not granted.");
            return;
        }

        String[] args = parseStringArray(call, "args");
        if (args == null) return;

        ensureResultReceiverRegistered();

        int timeoutMs = clamp(call.getInt("timeoutMs", 20000), 1000, 120000);
        Intent resultIntent = new Intent(TERMUX_RESULT_ACTION);
        resultIntent.setPackage(context.getPackageName());
        resultIntent.putExtra("requestId", requestId);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context,
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
            PendingTermuxCommand removed = activeCommands.remove(requestId);
            if (removed != null) {
                resolveResult(removed.call, requestId, true, "", "", null, true, null, "Termux command timed out.");
            }
        };
        activeCommands.put(requestId, pending);
        mainHandler.postDelayed(pending.timeoutRunnable, timeoutMs);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (SecurityException error) {
            activeCommands.remove(requestId);
            mainHandler.removeCallbacks(pending.timeoutRunnable);
            resolveUnavailable(call, requestId, "RUN_COMMAND permission is not granted.");
        } catch (Exception error) {
            activeCommands.remove(requestId);
            mainHandler.removeCallbacks(pending.timeoutRunnable);
            resolveUnavailable(call, requestId, error.getMessage() == null ? "Failed to start Termux command." : error.getMessage());
        }
    }

    public void destroy() {
        for (PendingTermuxCommand pending : activeCommands.values()) {
            if (pending.timeoutRunnable != null) {
                mainHandler.removeCallbacks(pending.timeoutRunnable);
            }
        }
        activeCommands.clear();
        if (resultReceiverRegistered) {
            try {
                context.unregisterReceiver(resultReceiver);
            } catch (Exception ignored) {
                // Android may already be tearing the process down.
            }
            resultReceiverRegistered = false;
        }
    }

    private JSObject createStatus() {
        boolean termuxInstalled = isTermuxInstalled();
        boolean termuxApiInstalled = isPackageInstalled(TERMUX_API_PACKAGE_NAME);
        boolean runCommandPermissionGranted = hasRunCommandPermission();
        boolean canRunCommands = termuxInstalled && runCommandPermissionGranted;

        JSObject result = new JSObject();
        result.put("available", canRunCommands);
        result.put("termuxInstalled", termuxInstalled);
        result.put("termuxApiInstalled", termuxApiInstalled);
        result.put("runCommandPermissionGranted", runCommandPermissionGranted);
        result.put("canRunCommands", canRunCommands);
        result.put("message", statusMessage(termuxInstalled, termuxApiInstalled, runCommandPermissionGranted));
        return result;
    }

    private String statusMessage(boolean termuxInstalled, boolean termuxApiInstalled, boolean runCommandPermissionGranted) {
        if (!termuxInstalled) return "Termux is not installed.";
        if (!runCommandPermissionGranted) return "RUN_COMMAND permission is not granted.";
        if (!termuxApiInstalled) return "Termux:API app is not installed.";
        return "Termux bridge is ready for diagnostics.";
    }

    private boolean isPackageInstalled(String packageName) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.getPackageManager().getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0));
            } else {
                context.getPackageManager().getPackageInfo(packageName, 0);
            }
            return true;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
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
        if (intent.resolveActivity(context.getPackageManager()) == null) {
            call.reject("No app can open this URL.");
            return;
        }

        context.startActivity(intent);
        resolveOk(call);
    }

    private synchronized void ensureResultReceiverRegistered() {
        if (resultReceiverRegistered) return;

        IntentFilter filter = new IntentFilter(TERMUX_RESULT_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(resultReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(resultReceiver, filter);
        }
        resultReceiverRegistered = true;
    }

    private void handleResult(Intent intent) {
        if (intent == null) return;

        String requestId = intent.getStringExtra("requestId");
        if (requestId == null) return;

        PendingTermuxCommand pending = activeCommands.remove(requestId);
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

        resolveResult(pending.call, requestId, true, stdout, stderr, exitCode, false, errCode, errmsg);
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

    private void resolveUnavailable(PluginCall call, String requestId, String message) {
        resolveResult(call, requestId, false, "", message, null, false, null, message);
    }

    private void resolveResult(
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
