package cz.behpoznamky.app.tracking;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "TrackingService",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        ),
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class TrackingServicePlugin extends Plugin {

    @PluginMethod
    public void checkTrackingPermissions(PluginCall call) {
        call.resolve(buildPermissionStatus());
    }

    @PluginMethod
    public void requestTrackingPermissions(PluginCall call) {
        if (!isLocationGranted()) {
            requestPermissionForAlias("location", call, "locationPermissionCallback");
            return;
        }
        continuePermissionRequest(call);
    }

    @PluginMethod
    public void startService(PluginCall call) {
        final int intervalMin = call.getInt("intervalMin", 5);
        final String sheetUrl = call.getString("sheetUrl", "");
        final String writeToken = call.getString("writeToken", "");

        if (!canStartTracking()) {
            call.reject("tracking_permissions_missing");
            return;
        }
        if (sheetUrl == null || sheetUrl.trim().isEmpty() || writeToken == null || writeToken.trim().isEmpty()) {
            call.reject("tracking_config_missing");
            return;
        }

        TrackingForegroundService.start(getContext(), intervalMin, sheetUrl, writeToken);

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("intervalMin", intervalMin);
        call.resolve(result);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        getContext().startService(TrackingForegroundService.createStopIntent(getContext()));

        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", TrackingForegroundService.isEnabled(getContext()));
        result.put("permissions", buildPermissionStatus());
        call.resolve(result);
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (!isLocationGranted()) {
            call.resolve(buildPermissionStatus());
            return;
        }
        continuePermissionRequest(call);
    }

    @PermissionCallback
    private void backgroundLocationPermissionCallback(PluginCall call) {
        continuePermissionRequest(call);
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        call.resolve(buildPermissionStatus());
    }

    private void continuePermissionRequest(PluginCall call) {
        if (!isBackgroundLocationGranted()) {
            requestPermissionForAlias("backgroundLocation", call, "backgroundLocationPermissionCallback");
            return;
        }
        if (!isNotificationGranted()) {
            requestPermissionForAlias("notifications", call, "notificationsPermissionCallback");
            return;
        }
        call.resolve(buildPermissionStatus());
    }

    private JSObject buildPermissionStatus() {
        JSObject result = new JSObject();
        result.put("locationGranted", isLocationGranted());
        result.put("backgroundGranted", isBackgroundLocationGranted());
        result.put("notificationsGranted", isNotificationGranted());
        result.put("canStart", canStartTracking());
        return result;
    }

    private boolean canStartTracking() {
        return isLocationGranted() && isBackgroundLocationGranted();
    }

    private boolean isLocationGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isBackgroundLocationGranted() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isNotificationGranted() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }
}
