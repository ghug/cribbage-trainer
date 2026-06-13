package dev.cribbage.cutthroat;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Minimal offline wrapper: one full-screen WebView that loads the bundled web app
 * from assets. No INTERNET permission, no third-party libraries — just the platform
 * WebView. Navigation between the landing page, trainer, and game (all local .html
 * files) stays inside the WebView; external links (the GitHub repo in About) are
 * handed to the device's browser via an Intent — the app itself never touches the
 * network, so this works while staying fully offline / INTERNET-permission-free.
 */
public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);   // the pages are React (CDN-free, bundled)
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                // Local app pages (file://) stay in the WebView; anything external
                // (http/https/mailto) opens in the system browser — the offline app
                // can't load it itself.
                if ("http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme)) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (ActivityNotFoundException ignored) {
                        // no app to handle it — do nothing rather than crash
                    }
                    return true;
                }
                return false;
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl("file:///android_asset/index.html");
        }

        setContentView(web);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
