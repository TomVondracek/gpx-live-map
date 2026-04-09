package cz.behpoznamky.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import cz.behpoznamky.app.vosk.VoskPlugin;
import cz.behpoznamky.app.googlestt.GoogleSTTPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoskPlugin.class);
        registerPlugin(GoogleSTTPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
