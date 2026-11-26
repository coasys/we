package org.coasys.app;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import org.coasys.app.devicekey.DeviceKeyPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin: registered before the bridge starts, so WE's page sees it.
        registerPlugin(DeviceKeyPlugin.class);
        super.onCreate(savedInstanceState);
        // The plugin's view of which document is loaded comes from the WebView's navigation
        // callbacks. The bridge installs its own client at the end of its constructor, so this
        // replaces it here, before the first navigation's callbacks (they arrive after onCreate).
        PluginHandle deviceKey = getBridge().getPlugin("DeviceKey");
        if (deviceKey != null) {
            ((DeviceKeyPlugin) deviceKey.getInstance()).installPageGate();
        }
        // Every page between the system bars and above the keyboard: see SafeArea.
        SafeArea.INSTANCE.install(getWindow(), (View) getBridge().getWebView().getParent());
    }
}
