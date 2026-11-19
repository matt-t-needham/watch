package us.materialio.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * bix: lets the living-room remote (av_control, over adb shell) read and set
 * the TV player's speed and quality:
 *
 *   am broadcast -a computer.bix.materialious.REMOTE -p computer.bix.materialious \
 *       --es cmd state|speed|quality [--es value v]
 *
 * The result code is 1 with the player state JSON as data, or 3 with a short
 * reason. A speed or quality change answers with the state from before it;
 * the page applies it and reports the new state a moment later.
 *
 * The state is whatever the TV player page last reported (report()), checked
 * here so a bad value never reaches the page.
 */
@CapacitorPlugin(name = "BixRemote")
public class BixRemote extends Plugin {
    private static final String TAG = "BixRemote";
    static final String ACTION = "computer.bix.materialious.REMOTE";
    private static final int OK = 1;
    private static final int FAILED = 3;

    // Written by report() on Capacitor's plugin thread, read on the main thread.
    private volatile String lastState = "{\"player\":false}";
    private BroadcastReceiver receiver;

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                handle(intent);
            }
        };
        // Exported on purpose: the sender is adb shell, which is another
        // process. Anything able to send it can only change the speed or
        // quality of a video already playing and read that state back.
        ContextCompat.registerReceiver(
                getContext(), receiver, new IntentFilter(ACTION), ContextCompat.RECEIVER_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            getContext().unregisterReceiver(receiver);
            receiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod()
    public void report(PluginCall call) {
        String state = call.getString("state");
        if (state == null) {
            call.reject("state is required");
            return;
        }
        try {
            new JSONObject(state);
        } catch (JSONException e) {
            call.reject("state is not a JSON object", e);
            return;
        }
        lastState = state;
        call.resolve();
    }

    private void handle(Intent intent) {
        String cmd = intent.getStringExtra("cmd");
        String value = intent.getStringExtra("value");
        String state = lastState;

        if ("state".equals(cmd)) {
            reply(OK, state);
            return;
        }
        if (!"speed".equals(cmd) && !"quality".equals(cmd)) {
            fail(cmd == null ? "missing cmd" : "unknown cmd " + cmd);
            return;
        }
        if (value == null) {
            fail("missing value");
            return;
        }

        JSONObject parsed;
        try {
            parsed = new JSONObject(state);
        } catch (JSONException e) {
            // report() checks this, so it shouldn't happen; say so if it does.
            Log.e(TAG, "ERROR: stored state is not JSON", e);
            fail("bad state");
            return;
        }
        if (!parsed.optBoolean("player", false)) {
            fail("no player open");
            return;
        }

        String reason = "speed".equals(cmd) ? checkSpeed(parsed, value) : checkQuality(parsed, value);
        if (reason != null) {
            fail(reason);
            return;
        }

        JSObject event = new JSObject();
        event.put("cmd", cmd);
        event.put("value", value);
        notifyListeners("remoteCommand", event);
        reply(OK, state);
    }

    /** Null when value is one of the offered speeds, else why not. */
    private static String checkSpeed(JSONObject state, String value) {
        double speed;
        try {
            speed = Double.parseDouble(value);
        } catch (NumberFormatException e) {
            return "speed is not a number";
        }
        JSONArray speeds = state.optJSONArray("speeds");
        if (speeds != null) {
            for (int i = 0; i < speeds.length(); i++) {
                if (Math.abs(speeds.optDouble(i, Double.NaN) - speed) < 1e-9) return null;
            }
        }
        return "speed " + value + " not offered";
    }

    /** Null when value is "auto" or one of the offered heights, else why not. */
    private static String checkQuality(JSONObject state, String value) {
        if ("auto".equals(value)) return null;
        JSONArray qualities = state.optJSONArray("qualities");
        if (qualities != null) {
            for (int i = 0; i < qualities.length(); i++) {
                Object height = qualities.opt(i);
                if (height instanceof Number && value.equals(String.valueOf(((Number) height).longValue()))) {
                    return null;
                }
            }
        }
        return "quality " + value + " not offered";
    }

    private void fail(String reason) {
        Log.w(TAG, "WARNING: remote command refused: " + reason);
        reply(FAILED, reason);
    }

    private void reply(int code, String data) {
        // Only an ordered broadcast (am broadcast is one) carries a result.
        if (!receiver.isOrderedBroadcast()) return;
        receiver.setResultCode(code);
        receiver.setResultData(data);
    }
}
