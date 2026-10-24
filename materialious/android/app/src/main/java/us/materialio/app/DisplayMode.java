package us.materialio.app;

import android.util.Log;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * bix: switches the display's refresh rate to suit the video, the way native
 * TV players do. A 24 or 25 fps video on a 59.94 Hz output can't show every
 * frame for the same time, which reads as judder. Only modes at the current
 * resolution are considered, so this never changes the picture size.
 */
@CapacitorPlugin(name = "DisplayMode")
public class DisplayMode extends Plugin {
    private static final String TAG = "DisplayMode";
    // 23.976 and 24 differ by 0.1%, so an exact multiple must be closer than that.
    private static final double EXACT = 0.0005;

    @PluginMethod()
    public void current(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Display.Mode mode = display().getMode();
            JSObject ret = new JSObject();
            ret.put("refreshRate", mode.getRefreshRate());
            ret.put("width", mode.getPhysicalWidth());
            ret.put("height", mode.getPhysicalHeight());
            call.resolve(ret);
        });
    }

    /** Prefers the current mode when it's already a multiple of fps, then the highest multiple. */
    @PluginMethod()
    public void matchFrameRate(PluginCall call) {
        Double fps = call.getDouble("fps");
        if (fps == null || fps <= 0) {
            call.reject("fps must be a positive number");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Display display = display();
            Display.Mode current = display.getMode();
            Display.Mode best = null;
            for (Display.Mode mode : display.getSupportedModes()) {
                if (mode.getPhysicalWidth() != current.getPhysicalWidth()
                        || mode.getPhysicalHeight() != current.getPhysicalHeight()) continue;
                if (!isMultiple(mode.getRefreshRate(), fps)) continue;
                if (mode.getModeId() == current.getModeId()) {
                    best = mode;
                    break;
                }
                if (best == null || mode.getRefreshRate() > best.getRefreshRate()) best = mode;
            }

            JSObject ret = new JSObject();
            if (best == null) {
                Log.w(TAG, "WARNING: no display mode at " + current.getPhysicalWidth() + "x"
                        + current.getPhysicalHeight() + " is a multiple of " + fps + " fps");
                ret.put("matched", false);
                ret.put("refreshRate", current.getRefreshRate());
                call.resolve(ret);
                return;
            }
            setPreferredMode(best.getModeId());
            ret.put("matched", true);
            ret.put("refreshRate", best.getRefreshRate());
            call.resolve(ret);
        });
    }

    /** Hands the choice back to the system (its default mode). */
    @PluginMethod()
    public void reset(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            setPreferredMode(0);
            call.resolve();
        });
    }

    private static boolean isMultiple(double refreshRate, double fps) {
        long multiple = Math.round(refreshRate / fps);
        if (multiple < 1) return false;
        return Math.abs(refreshRate - multiple * fps) <= refreshRate * EXACT;
    }

    private Display display() {
        return getActivity().getWindowManager().getDefaultDisplay();
    }

    private void setPreferredMode(int modeId) {
        Window window = getActivity().getWindow();
        WindowManager.LayoutParams params = window.getAttributes();
        if (params.preferredDisplayModeId == modeId) return;
        params.preferredDisplayModeId = modeId;
        window.setAttributes(params);
    }
}
