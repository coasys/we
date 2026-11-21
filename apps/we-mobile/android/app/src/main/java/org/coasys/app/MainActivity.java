package org.coasys.app;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;
import org.coasys.app.devicekey.DeviceKeyPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin: registered before the bridge starts, so WE's page sees it.
        registerPlugin(DeviceKeyPlugin.class);
        super.onCreate(savedInstanceState);
        // Every page between the system bars and above the keyboard: see SafeArea.
        SafeArea.INSTANCE.install(getWindow(), (View) getBridge().getWebView().getParent());
    }
}
