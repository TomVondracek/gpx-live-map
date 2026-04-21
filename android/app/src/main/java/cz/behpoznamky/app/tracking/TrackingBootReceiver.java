package cz.behpoznamky.app.tracking;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class TrackingBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        final String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            TrackingForegroundService.restartIfEnabled(context);
        }
    }
}
