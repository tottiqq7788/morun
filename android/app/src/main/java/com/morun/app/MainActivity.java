package com.morun.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int APP_BACKGROUND_COLOR = Color.rgb(243, 238, 230);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MorunNativePlugin.class);
        super.onCreate(savedInstanceState);
        configureSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        configureSystemBars();
    }

    private void configureSystemBars() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setBackgroundDrawable(new ColorDrawable(APP_BACKGROUND_COLOR));
        window.getDecorView().setBackgroundColor(APP_BACKGROUND_COLOR);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
    }
}
