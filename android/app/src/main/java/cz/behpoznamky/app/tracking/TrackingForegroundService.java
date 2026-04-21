package cz.behpoznamky.app.tracking;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import cz.behpoznamky.app.MainActivity;
import cz.behpoznamky.app.R;

public class TrackingForegroundService extends Service {
    private static final String TAG = "TrackingFgService";

    public static final String ACTION_START = "cz.behpoznamky.app.action.START_TRACKING";
    public static final String ACTION_STOP = "cz.behpoznamky.app.action.STOP_TRACKING";
    public static final String EXTRA_INTERVAL_MIN = "intervalMin";
    public static final String EXTRA_SHEET_URL = "sheetUrl";
    public static final String EXTRA_WRITE_TOKEN = "writeToken";

    public static final String PREFS_NAME = "tracking-foreground-service";
    public static final String PREF_ENABLED = "enabled";
    public static final String PREF_INTERVAL_MIN = "intervalMin";
    public static final String PREF_SHEET_URL = "sheetUrl";
    public static final String PREF_WRITE_TOKEN = "writeToken";
    public static final String PREF_QUEUE = "queue";

    private static final String NOTIFICATION_CHANNEL_ID = "tracking_foreground";
    private static final int NOTIFICATION_ID = 4107;
    private static final long LOCATION_UPDATE_MIN_MS = 5000L;
    private static final float LOCATION_UPDATE_MIN_DISTANCE_M = 0f;
    private static final long MAX_LOCATION_AGE_MS = 2 * 60 * 1000L;

    private final AtomicBoolean sendInProgress = new AtomicBoolean(false);

    private SharedPreferences prefs;
    private Handler handler;
    private ExecutorService executor;
    private LocationManager locationManager;
    private LocationListener locationListener;
    private PowerManager.WakeLock wakeLock;
    private Location lastLocation;

    private int intervalMin = 5;
    private String sheetUrl = "";
    private String writeToken = "";

    private final Runnable tickRunnable = new Runnable() {
        @Override
        public void run() {
            triggerSend();
            if (handler != null) {
                handler.postDelayed(this, intervalMin * 60L * 1000L);
            }
        }
    };

    public static Intent createStartIntent(Context context) {
        return new Intent(context, TrackingForegroundService.class).setAction(ACTION_START);
    }

    public static Intent createStartIntent(Context context, int intervalMin, String sheetUrl, String writeToken) {
        return createStartIntent(context)
            .putExtra(EXTRA_INTERVAL_MIN, intervalMin)
            .putExtra(EXTRA_SHEET_URL, sheetUrl)
            .putExtra(EXTRA_WRITE_TOKEN, writeToken);
    }

    public static Intent createStopIntent(Context context) {
        return new Intent(context, TrackingForegroundService.class).setAction(ACTION_STOP);
    }

    public static void start(Context context, int intervalMin, String sheetUrl, String writeToken) {
        ContextCompat.startForegroundService(context, createStartIntent(context, intervalMin, sheetUrl, writeToken));
    }

    public static void restartIfEnabled(Context context) {
        if (isEnabled(context)) {
            ContextCompat.startForegroundService(context, createStartIntent(context));
        }
    }

    public static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getBoolean(PREF_ENABLED, false);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        handler = new Handler(Looper.getMainLooper());
        executor = Executors.newSingleThreadExecutor();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        final PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":tracking");
            wakeLock.setReferenceCounted(false);
        }
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String action = intent != null ? intent.getAction() : ACTION_START;
        if (ACTION_STOP.equals(action)) {
            stopTracking(true);
            return START_NOT_STICKY;
        }

        loadConfig(intent);
        if (TextUtils.isEmpty(sheetUrl) || TextUtils.isEmpty(writeToken)) {
            Log.w(TAG, "Missing tracking config, stopping service");
            stopTracking(false);
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification());
        acquireWakeLock();
        startLocationUpdates();
        restartTickLoop();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
        releaseWakeLock();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void loadConfig(Intent intent) {
        final int requestedInterval = intent != null ? intent.getIntExtra(EXTRA_INTERVAL_MIN, -1) : -1;
        final String requestedSheetUrl = intent != null ? intent.getStringExtra(EXTRA_SHEET_URL) : null;
        final String requestedWriteToken = intent != null ? intent.getStringExtra(EXTRA_WRITE_TOKEN) : null;

        intervalMin = requestedInterval > 0 ? requestedInterval : prefs.getInt(PREF_INTERVAL_MIN, 5);
        sheetUrl = !TextUtils.isEmpty(requestedSheetUrl) ? requestedSheetUrl : prefs.getString(PREF_SHEET_URL, "");
        writeToken = !TextUtils.isEmpty(requestedWriteToken) ? requestedWriteToken : prefs.getString(PREF_WRITE_TOKEN, "");

        prefs.edit()
            .putBoolean(PREF_ENABLED, true)
            .putInt(PREF_INTERVAL_MIN, intervalMin)
            .putString(PREF_SHEET_URL, sheetUrl)
            .putString(PREF_WRITE_TOKEN, writeToken)
            .apply();
    }

    private void stopTracking(boolean clearEnabled) {
        if (handler != null) {
            handler.removeCallbacks(tickRunnable);
        }
        stopLocationUpdates();

        if (clearEnabled && prefs != null) {
            prefs.edit().putBoolean(PREF_ENABLED, false).apply();
        }

        releaseWakeLock();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    private void restartTickLoop() {
        if (handler == null) {
            return;
        }
        handler.removeCallbacks(tickRunnable);
        handler.post(tickRunnable);
    }

    private void triggerSend() {
        if (executor == null || !sendInProgress.compareAndSet(false, true)) {
            return;
        }

        executor.execute(() -> {
            try {
                sendTrackPoint();
            } catch (Exception err) {
                Log.e(TAG, "Track send failed", err);
            } finally {
                sendInProgress.set(false);
            }
        });
    }

    private void sendTrackPoint() throws Exception {
        final JSONObject payload = buildPayload();
        if (payload == null) {
            return;
        }

        try {
            postPayload(payload, sheetUrl);
        } catch (Exception err) {
            enqueuePayload(payload);
            throw err;
        } finally {
            flushQueue();
        }
    }

    private JSONObject buildPayload() throws Exception {
        final Location location = getBestLocation();
        final JSONObject payload = new JSONObject();
        payload.put("entry_id", java.util.UUID.randomUUID().toString());
        payload.put("entry_type", "track");
        payload.put("time", nowIsoUtc());
        payload.put("lat", location != null ? location.getLatitude() : JSONObject.NULL);
        payload.put("lon", location != null ? location.getLongitude() : JSONObject.NULL);
        payload.put("battery", getBatteryLevel());
        payload.put("speed", location != null && location.hasSpeed()
            ? Math.round(location.getSpeed() * 3.6 * 10.0) / 10.0
            : JSONObject.NULL);
        payload.put("altitude", location != null && location.hasAltitude()
            ? Math.round(location.getAltitude())
            : JSONObject.NULL);
        payload.put("gps_accuracy", location != null && location.hasAccuracy()
            ? Math.round(location.getAccuracy())
            : JSONObject.NULL);
        payload.put("token", writeToken);
        return payload;
    }

    private void enqueuePayload(JSONObject payload) {
        try {
            final JSONArray queue = new JSONArray(prefs.getString(PREF_QUEUE, "[]"));
            final JSONObject queueItem = new JSONObject();
            queueItem.put("payload", payload);
            queueItem.put("createdAt", nowIsoUtc());
            queue.put(queueItem);

            final JSONArray trimmed = new JSONArray();
            final int start = Math.max(0, queue.length() - 200);
            for (int i = start; i < queue.length(); i++) {
                trimmed.put(queue.getJSONObject(i));
            }
            prefs.edit().putString(PREF_QUEUE, trimmed.toString()).apply();
        } catch (Exception err) {
            Log.e(TAG, "Failed to enqueue tracking payload", err);
        }
    }

    private void flushQueue() {
        try {
            final JSONArray queue = new JSONArray(prefs.getString(PREF_QUEUE, "[]"));
            if (queue.length() == 0) {
                return;
            }

            final JSONArray remaining = new JSONArray();
            for (int i = 0; i < queue.length(); i++) {
                final JSONObject item = queue.getJSONObject(i);
                try {
                    postPayload(item.getJSONObject("payload"), sheetUrl);
                } catch (Exception err) {
                    for (int j = i; j < queue.length(); j++) {
                        remaining.put(queue.getJSONObject(j));
                    }
                    break;
                }
            }
            prefs.edit().putString(PREF_QUEUE, remaining.toString()).apply();
        } catch (Exception err) {
            Log.e(TAG, "Failed to flush queue", err);
        }
    }

    private void postPayload(JSONObject payload, String urlString) throws Exception {
        HttpURLConnection connection = null;
        try {
            final URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

            try (OutputStream os = connection.getOutputStream()) {
                os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }

            final int status = connection.getResponseCode();
            final InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            final String responseText = readStream(stream);

            if (status < 200 || status >= 300) {
                throw new IllegalStateException("HTTP " + status);
            }

            if (!TextUtils.isEmpty(responseText)) {
                final JSONObject response = new JSONObject(responseText);
                if (response.optBoolean("ok", true) == false) {
                    throw new IllegalStateException(response.optString("error", "api_error"));
                }
            }
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) {
            return "";
        }

        try (InputStream is = stream; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[2048];
            int read;
            while ((read = is.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toString(StandardCharsets.UTF_8.name());
        }
    }

    private Integer getBatteryLevel() {
        try {
            final BatteryManager batteryManager = (BatteryManager) getSystemService(BATTERY_SERVICE);
            if (batteryManager == null) {
                return null;
            }
            final int level = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return level >= 0 ? level : null;
        } catch (Exception err) {
            Log.w(TAG, "Battery read failed", err);
            return null;
        }
    }

    private void startLocationUpdates() {
        if (locationManager == null || locationListener != null) {
            return;
        }
        if (!hasLocationPermission()) {
            Log.w(TAG, "Location permission missing, cannot start updates");
            return;
        }

        locationListener = location -> {
            if (location != null) {
                lastLocation = location;
            }
        };

        tryRegisterProvider(LocationManager.GPS_PROVIDER);
        tryRegisterProvider(LocationManager.NETWORK_PROVIDER);
    }

    private void tryRegisterProvider(String provider) {
        try {
            if (locationManager.isProviderEnabled(provider)) {
                locationManager.requestLocationUpdates(
                    provider,
                    LOCATION_UPDATE_MIN_MS,
                    LOCATION_UPDATE_MIN_DISTANCE_M,
                    locationListener,
                    Looper.getMainLooper()
                );
            }
        } catch (Exception err) {
            Log.w(TAG, "Failed to register provider " + provider, err);
        }
    }

    private void stopLocationUpdates() {
        if (locationManager == null || locationListener == null) {
            return;
        }
        try {
            locationManager.removeUpdates(locationListener);
        } catch (Exception err) {
            Log.w(TAG, "Failed to remove location updates", err);
        }
        locationListener = null;
    }

    private Location getBestLocation() {
        if (lastLocation != null && (System.currentTimeMillis() - lastLocation.getTime()) <= MAX_LOCATION_AGE_MS) {
            return lastLocation;
        }

        Location best = lastLocation;
        if (locationManager == null || !hasLocationPermission()) {
            return best;
        }

        for (String provider : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
            try {
                final Location candidate = locationManager.getLastKnownLocation(provider);
                if (candidate == null) {
                    continue;
                }
                if (best == null || candidate.getTime() > best.getTime()) {
                    best = candidate;
                }
            } catch (Exception err) {
                Log.w(TAG, "Failed to read last known location from " + provider, err);
            }
        }

        lastLocation = best;
        return best;
    }

    private boolean hasLocationPermission() {
        return ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private String nowIsoUtc() {
        final SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private Notification buildNotification() {
        final Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        final PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("UltraLog tracking aktivní")
            .setContentText("Auto-tracking každých " + intervalMin + " min")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        final NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "Auto-tracking",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Běží foreground tracking polohy");

        final NotificationManager notificationManager = getSystemService(NotificationManager.class);
        if (notificationManager != null) {
            notificationManager.createNotificationChannel(channel);
        }
    }

    private void acquireWakeLock() {
        if (wakeLock == null || wakeLock.isHeld()) {
            return;
        }
        try {
            wakeLock.acquire();
        } catch (Exception err) {
            Log.w(TAG, "Failed to acquire wake lock", err);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock == null || !wakeLock.isHeld()) {
            return;
        }
        try {
            wakeLock.release();
        } catch (Exception err) {
            Log.w(TAG, "Failed to release wake lock", err);
        }
    }
}
