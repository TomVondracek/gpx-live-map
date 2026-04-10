package cz.behpoznamky.app.googlestt;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Capacitor plugin pro online rozpoznávání řeči pomocí Android SpeechRecognizer (Google STT).
 * Používá se, když je zařízení online. Offline fallback zajišťuje VoskPlugin.
 *
 * Event rozhraní je shodné s VoskPlugin:
 *   - "result"  → { text: String, isFinal: boolean }
 *   - "stopped" → { reason: String }
 *   - "error"   → { message: String }
 */
@CapacitorPlugin(
    name = "GoogleSTT",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class GoogleSTTPlugin extends Plugin {

    private static final String TAG = "GoogleSTTPlugin";
    private static final String LANGUAGE = "cs-CZ";

    private SpeechRecognizer speechRecognizer = null;
    private volatile boolean isListening = false;

    // ── Dostupnost ───────────────────────────────────────────────────────────

    /**
     * Zkontroluje, zda je SpeechRecognizer dostupný na zařízení.
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean available = SpeechRecognizer.isRecognitionAvailable(getContext());
        Log.i(TAG, "SpeechRecognizer available: " + available);
        JSObject ret = new JSObject();
        ret.put("available", available);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkMicrophonePermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasPermission(Manifest.permission.RECORD_AUDIO));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestMicrophonePermission(PluginCall call) {
        if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }

        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    // ── Nahrávání ────────────────────────────────────────────────────────────

    @PluginMethod
    public void startListening(PluginCall call) {
        if (isListening) {
            call.reject("Nahrávání již probíhá.");
            return;
        }

        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            requestPermissions(call);
            return;
        }

        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("SpeechRecognizer není na tomto zařízení dostupný.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                speechRecognizer.setRecognitionListener(createListener());

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, LANGUAGE);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, LANGUAGE);
                intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, LANGUAGE);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                // Na novějších verzích Androidu zkus zapnout nativní interpunkci
                // a kapitalizaci od Google rozpoznávače. Pokud zařízení extra nepodporuje,
                // SpeechRecognizer je prostě ignoruje.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING,
                        RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY);
                    intent.putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true);
                }
                // Prodloužené silence timeouty — prostor pro pomlky při diktování
                // Poznámka: Android tyto hodnoty bere jako hinty, skutečné chování závisí na Google STT serveru
                intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 6000L);
                intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 5000L);
                intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 4000L);

                isListening = true;
                speechRecognizer.startListening(intent);

                Log.i(TAG, "Nahrávání spuštěno (Google STT, " + LANGUAGE + ")");

                JSObject ret = new JSObject();
                ret.put("listening", true);
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "Chyba při spuštění nahrávání", e);
                isListening = false;
                call.reject("Chyba při spuštění nahrávání: " + e.getMessage());
                cleanup();
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        if (!isListening) {
            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                if (speechRecognizer != null) {
                    speechRecognizer.stopListening();
                }
            } catch (Exception e) {
                Log.w(TAG, "stopListening error", e);
            }
            // isListening bude nastaveno na false v onResults/onError callbacku
        });

        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasPermission(Manifest.permission.RECORD_AUDIO));
        if (call != null) {
            call.resolve(ret);
        }
    }

    // ── RecognitionListener ──────────────────────────────────────────────────

    private RecognitionListener createListener() {
        return new RecognitionListener() {

            @Override
            public void onReadyForSpeech(Bundle params) {
                Log.d(TAG, "onReadyForSpeech");
            }

            @Override
            public void onBeginningOfSpeech() {
                Log.d(TAG, "onBeginningOfSpeech");
            }

            @Override
            public void onRmsChanged(float rmsdB) {
                // Ignorujeme — příliš častý callback
            }

            @Override
            public void onBufferReceived(byte[] buffer) {
                // Nepoužíváme
            }

            @Override
            public void onEndOfSpeech() {
                Log.d(TAG, "onEndOfSpeech");
            }

            @Override
            public void onError(int error) {
                String errorMsg = getErrorMessage(error);
                Log.e(TAG, "onError: " + error + " (" + errorMsg + ")");

                isListening = false;

                // ERROR_NO_MATCH a ERROR_SPEECH_TIMEOUT nejsou fatální chyby —
                // jen signalizují, že nebyla rozpoznána řeč
                if (error == SpeechRecognizer.ERROR_NO_MATCH
                        || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    sendStoppedEvent("silence");
                } else {
                    sendErrorEvent(errorMsg);
                }

                cleanup();
            }

            @Override
            public void onResults(Bundle results) {
                Log.d(TAG, "onResults");
                isListening = false;

                ArrayList<String> matches = results.getStringArrayList(
                    SpeechRecognizer.RESULTS_RECOGNITION);

                if (matches != null && !matches.isEmpty()) {
                    String text = matches.get(0).trim();
                    Log.i(TAG, "Final result: '" + text + "'");

                    if (!text.isEmpty()) {
                        sendResultEvent(text, true);
                    }
                }

                sendStoppedEvent("end_of_speech");
                cleanup();
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                ArrayList<String> matches = partialResults.getStringArrayList(
                    SpeechRecognizer.RESULTS_RECOGNITION);

                if (matches != null && !matches.isEmpty()) {
                    String text = matches.get(0).trim();
                    if (!text.isEmpty()) {
                        Log.d(TAG, "Partial: '" + text + "'");
                        sendResultEvent(text, false);
                    }
                }
            }

            @Override
            public void onEvent(int eventType, Bundle params) {
                Log.d(TAG, "onEvent: " + eventType);
            }
        };
    }

    // ── Event helpers ────────────────────────────────────────────────────────

    private void sendResultEvent(String text, boolean isFinal) {
        JSObject event = new JSObject();
        event.put("text", text);
        event.put("isFinal", isFinal);
        notifyListeners("result", event);
    }

    private void sendStoppedEvent(String reason) {
        JSObject event = new JSObject();
        event.put("reason", reason);
        notifyListeners("stopped", event);
    }

    private void sendErrorEvent(String message) {
        JSObject event = new JSObject();
        event.put("message", message);
        notifyListeners("error", event);
    }

    // ── Error kódy ───────────────────────────────────────────────────────────

    private String getErrorMessage(int errorCode) {
        switch (errorCode) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "Chyba nahrávání zvuku";
            case SpeechRecognizer.ERROR_CLIENT:
                return "Chyba klienta";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Nedostatečná oprávnění";
            case SpeechRecognizer.ERROR_NETWORK:
                return "Chyba sítě";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "Timeout sítě";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "Žádná shoda";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Rozpoznávač je zaneprázdněný";
            case SpeechRecognizer.ERROR_SERVER:
                return "Chyba serveru";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "Timeout řeči";
            default:
                return "Neznámá chyba (" + errorCode + ")";
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

    private void cleanup() {
        // SpeechRecognizer musí být uvolněn na UI threadu
        getActivity().runOnUiThread(() -> {
            if (speechRecognizer != null) {
                try {
                    speechRecognizer.destroy();
                } catch (Exception e) {
                    Log.w(TAG, "SpeechRecognizer destroy error", e);
                }
                speechRecognizer = null;
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        isListening = false;
        cleanup();
        super.handleOnDestroy();
    }
}
