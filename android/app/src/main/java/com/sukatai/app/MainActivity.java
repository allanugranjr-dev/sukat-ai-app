package com.sukatai.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private OnBackPressedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        backCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dispatchBack();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backCallback);
    }

    private void dispatchBack() {
        if (bridge == null || bridge.getWebView() == null) {
            finish();
            return;
        }

        bridge.getWebView().evaluateJavascript(
            "(function(){var event=new CustomEvent('sukatai:native-back',{cancelable:true});return window.dispatchEvent(event);})()",
            handled -> {
                if ("true".equals(handled)) {
                    finish();
                }
            }
        );
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
    }
}
