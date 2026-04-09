package cz.behpoznamky.app.vosk;

import android.Manifest;
import android.content.res.AssetManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONException;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Capacitor plugin pro offline rozpoznávání řeči pomocí Vosk.
 * Český model je bundlovaný v assets/models/vosk-model-small-cs.
 */
@CapacitorPlugin(
    name = "VoskSTT",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class VoskPlugin extends Plugin {

    private static final String TAG = "VoskPlugin";
    private static final int SAMPLE_RATE = 16000;
    private static final String MODEL_PATH = "models/vosk-model-small-cs";

    // Silence detection konfigurace
    private static final int SILENCE_THRESHOLD = 1500;    // amplituda pod kterou je ticho (16-bit PCM rozsah 0-32768)
    private static final double SILENCE_TIMEOUT_SEC = 6.0; // sekundy ticha pro auto-stop (prodlouženo pro pomlky při diktování)
    private static final double GRACE_PERIOD_SEC = 3.0;    // ignorovat ticho na začátku (čas na přípravu)

    private Model model = null;
    private Recognizer recognizer = null;
    private AudioRecord audioRecord = null;
    private Thread recordingThread = null;
    private volatile boolean isListening = false;
    private volatile boolean modelLoading = false;

    // ── Inicializace modelu ──────────────────────────────────────────────────

    /**
     * Inicializuje Vosk model z assets.
     * Kopíruje model z assets do interního úložiště a načte ho.
     * Volat jednou při startu aplikace.
     */
    @PluginMethod
    public void initialize(PluginCall call) {
        if (model != null) {
            JSObject ret = new JSObject();
            ret.put("ready", true);
            call.resolve(ret);
            return;
        }

        if (modelLoading) {
            call.reject("Model se již načítá");
            return;
        }

        modelLoading = true;

        new Thread(() -> {
            try {
                File modelDir = new File(getContext().getFilesDir(), "vosk-model");

                // Zkontroluj, zda model už je extrahovaný
                File completeMarker = new File(modelDir, ".complete");
                if (!completeMarker.exists()) {
                    Log.i(TAG, "Extrahuji Vosk model z assets...");
                    copyAssetDir(MODEL_PATH, modelDir);
                    completeMarker.createNewFile();
                    Log.i(TAG, "Vosk model extrahován do " + modelDir.getAbsolutePath());
                } else {
                    Log.i(TAG, "Vosk model již extrahován: " + modelDir.getAbsolutePath());
                }

                model = new Model(modelDir.getAbsolutePath());
                modelLoading = false;
                Log.i(TAG, "Vosk model načten úspěšně");

                JSObject ret = new JSObject();
                ret.put("ready", true);
                call.resolve(ret);

            } catch (Exception e) {
                modelLoading = false;
                Log.e(TAG, "Chyba při načítání Vosk modelu", e);
                call.reject("Nepodařilo se načíst Vosk model: " + e.getMessage());
            }
        }, "VoskModelLoader").start();
    }

    // ── Status ───────────────────────────────────────────────────────────────

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("modelReady", model != null);
        ret.put("modelLoading", modelLoading);
        ret.put("isListening", isListening);
        call.resolve(ret);
    }

    // ── Nahrávání ────────────────────────────────────────────────────────────

    @PluginMethod
    public void startListening(PluginCall call) {
        if (model == null) {
            call.reject("Model není inicializován. Zavolej nejprve initialize().");
            return;
        }

        if (isListening) {
            call.reject("Nahrávání již probíhá.");
            return;
        }

        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            requestPermissions(call);
            return;
        }

        try {
            recognizer = new Recognizer(model, SAMPLE_RATE);
            recognizer.setPartialWords(false);

            int bufferSize = Math.max(
                AudioRecord.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                ),
                4096
            );

            audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            );

            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                call.reject("Nepodařilo se inicializovat AudioRecord");
                cleanup();
                return;
            }

            isListening = true;
            audioRecord.startRecording();

            recordingThread = new Thread(() -> processAudio(bufferSize), "VoskRecordingThread");
            recordingThread.start();

            Log.i(TAG, "Nahrávání spuštěno (bufferSize=" + bufferSize + ")");

            JSObject ret = new JSObject();
            ret.put("listening", true);
            call.resolve(ret);

        } catch (IOException e) {
            Log.e(TAG, "Chyba při spuštění nahrávání", e);
            call.reject("Chyba při spuštění nahrávání: " + e.getMessage());
            cleanup();
        }
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        if (!isListening) {
            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
            return;
        }

        isListening = false;

        // Počkej na dokončení recording threadu
        if (recordingThread != null) {
            try {
                recordingThread.join(3000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        // Získej finální výsledek (pokud recognizer ještě existuje)
        Recognizer rec = recognizer;
        if (rec != null) {
            try {
                String finalResultJson = rec.getFinalResult();
                String text = extractText(finalResultJson);
                Log.i(TAG, "stopListening finalResult: '" + text + "'");

                JSObject event = new JSObject();
                event.put("text", text);
                event.put("isFinal", true);
                notifyListeners("result", event);
            } catch (Exception e) {
                Log.w(TAG, "getFinalResult error (recognizer may be closed)", e);
            }
        }

        cleanup();

        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    // ── Audio processing ─────────────────────────────────────────────────────

    private void processAudio(int bufferSize) {
        byte[] buffer = new byte[bufferSize];

        // Silence detection state
        int silenceFrames = 0;
        boolean hasHeardSpeech = false;
        long startTimeMs = System.currentTimeMillis();

        // Kolik frames = N sekund ticha
        int framesPerSecond = SAMPLE_RATE * 2 / bufferSize; // *2 protože 16-bit = 2 bytes per sample
        int maxSilenceFrames = (int) (SILENCE_TIMEOUT_SEC * framesPerSecond);
        int graceFrames = (int) (GRACE_PERIOD_SEC * framesPerSecond);
        int frameCount = 0;

        Log.i(TAG, "processAudio: framesPerSec=" + framesPerSecond
            + " maxSilence=" + maxSilenceFrames
            + " grace=" + graceFrames
            + " threshold=" + SILENCE_THRESHOLD);

        while (isListening) {
            int bytesRead = audioRecord.read(buffer, 0, buffer.length);

            if (bytesRead > 0) {
                frameCount++;

                // Předej audio Vosku
                boolean accepted = recognizer.acceptWaveForm(buffer, bytesRead);

                if (accepted) {
                    String resultJson = recognizer.getResult();
                    String text = extractText(resultJson);
                    Log.d(TAG, "Vosk result: '" + text + "'");

                    if (!text.isEmpty()) {
                        hasHeardSpeech = true;
                        silenceFrames = 0;
                        sendResultEvent(text, true);
                    }
                } else {
                    String partialJson = recognizer.getPartialResult();
                    String partial = extractPartial(partialJson);

                    if (!partial.isEmpty()) {
                        hasHeardSpeech = true;
                        silenceFrames = 0;
                        sendResultEvent(partial, false);
                    }
                }

                // Silence detection — aktivní jen po grace period a jen pokud už uživatel mluvil
                if (frameCount > graceFrames) {
                    int maxAmplitude = getMaxAmplitude(buffer, bytesRead);

                    if (maxAmplitude < SILENCE_THRESHOLD) {
                        silenceFrames++;

                        // Auto-stop jen pokud uživatel už mluvil a pak ztichl
                        if (hasHeardSpeech && silenceFrames >= maxSilenceFrames) {
                            Log.i(TAG, "Silence detected after speech, auto-stopping");
                            isListening = false;

                            // Získej finální výsledek
                            String finalResultJson = recognizer.getFinalResult();
                            String text = extractText(finalResultJson);
                            Log.i(TAG, "Auto-stop finalResult: '" + text + "'");

                            if (!text.isEmpty()) {
                                sendResultEvent(text, true);
                            }

                            // Signalizuj konec nahrávání
                            sendStoppedEvent("silence");
                        }
                    } else {
                        silenceFrames = 0;
                    }
                }

            } else if (bytesRead < 0) {
                Log.e(TAG, "AudioRecord read error: " + bytesRead);
                isListening = false;
                sendErrorEvent("Chyba čtení z mikrofonu");
                break;
            }
        }

        Log.i(TAG, "processAudio loop ended, frameCount=" + frameCount + " hasHeardSpeech=" + hasHeardSpeech);
    }

    // ── Event helpers (posílání z main threadu) ──────────────────────────────

    private void sendResultEvent(String text, boolean isFinal) {
        getActivity().runOnUiThread(() -> {
            JSObject event = new JSObject();
            event.put("text", text);
            event.put("isFinal", isFinal);
            notifyListeners("result", event);
        });
    }

    private void sendStoppedEvent(String reason) {
        getActivity().runOnUiThread(() -> {
            JSObject event = new JSObject();
            event.put("reason", reason);
            notifyListeners("stopped", event);
        });
    }

    private void sendErrorEvent(String message) {
        getActivity().runOnUiThread(() -> {
            JSObject event = new JSObject();
            event.put("message", message);
            notifyListeners("error", event);
        });
    }

    // ── Audio helpers ────────────────────────────────────────────────────────

    private int getMaxAmplitude(byte[] buffer, int bytesRead) {
        int max = 0;
        for (int i = 0; i < bytesRead - 1; i += 2) {
            int sample = Math.abs((short) ((buffer[i + 1] << 8) | (buffer[i] & 0xFF)));
            if (sample > max) max = sample;
        }
        return max;
    }

    // ── Vosk JSON parsing ────────────────────────────────────────────────────

    private String extractText(String json) {
        try {
            JSONObject obj = new JSONObject(json);
            return obj.optString("text", "").trim();
        } catch (JSONException e) {
            return "";
        }
    }

    private String extractPartial(String json) {
        try {
            JSONObject obj = new JSONObject(json);
            return obj.optString("partial", "").trim();
        } catch (JSONException e) {
            return "";
        }
    }

    // ── Asset kopírování ─────────────────────────────────────────────────────

    private void copyAssetDir(String assetPath, File destDir) throws IOException {
        AssetManager assets = getContext().getAssets();
        String[] list = assets.list(assetPath);

        if (list == null || list.length == 0) {
            copyAssetFile(assetPath, destDir);
            return;
        }

        if (!destDir.exists()) {
            destDir.mkdirs();
        }

        for (String child : list) {
            String childAssetPath = assetPath + "/" + child;
            File childDest = new File(destDir, child);

            String[] subList = assets.list(childAssetPath);
            if (subList != null && subList.length > 0) {
                copyAssetDir(childAssetPath, childDest);
            } else {
                copyAssetFile(childAssetPath, childDest);
            }
        }
    }

    private void copyAssetFile(String assetPath, File destFile) throws IOException {
        File parent = destFile.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }

        try (InputStream in = getContext().getAssets().open(assetPath);
             OutputStream out = new FileOutputStream(destFile)) {
            byte[] buf = new byte[8192];
            int len;
            while ((len = in.read(buf)) > 0) {
                out.write(buf, 0, len);
            }
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

    private void cleanup() {
        isListening = false;

        if (audioRecord != null) {
            try {
                if (audioRecord.getState() == AudioRecord.STATE_INITIALIZED) {
                    audioRecord.stop();
                }
            } catch (IllegalStateException e) {
                Log.w(TAG, "AudioRecord stop error", e);
            }
            audioRecord.release();
            audioRecord = null;
        }

        if (recognizer != null) {
            try {
                recognizer.close();
            } catch (Exception e) {
                Log.w(TAG, "Recognizer close error", e);
            }
            recognizer = null;
        }

        recordingThread = null;
    }

    @Override
    protected void handleOnDestroy() {
        cleanup();
        if (model != null) {
            model.close();
            model = null;
        }
        super.handleOnDestroy();
    }
}
