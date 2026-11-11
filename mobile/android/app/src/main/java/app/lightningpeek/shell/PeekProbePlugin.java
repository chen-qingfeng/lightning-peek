package app.lightningpeek.shell;

import android.app.ActivityManager;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Debug;
import android.os.Process;
import android.provider.OpenableColumns;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** 验证壳用的小插件：机型、进程内存，以及「用其他应用打开」时把 content:// 复制到缓存。 */
@CapacitorPlugin(name = "PeekProbe")
public class PeekProbePlugin extends Plugin {
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("model", Build.MODEL);
        ret.put("release", Build.VERSION.RELEASE);
        ret.put("sdk", Build.VERSION.SDK_INT);
        String abi = Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "";
        ret.put("abi", abi);
        ret.put("is64Bit", Process.is64Bit());
        String web = "";
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
                if (info != null && info.versionName != null) web = info.versionName;
            }
        } catch (Throwable ignored) { /* 老系统没有这个接口 */ }
        ret.put("webView", web);
        call.resolve(ret);
    }

    @PluginMethod
    public void getMemory(PluginCall call) {
        Debug.MemoryInfo self = new Debug.MemoryInfo();
        Debug.getMemoryInfo(self);
        int pss = self.getTotalPss();
        try {
            ActivityManager am = (ActivityManager) getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
            if (am != null) {
                Debug.MemoryInfo[] arr = am.getProcessMemoryInfo(new int[] { Process.myPid() });
                if (arr != null && arr.length > 0) pss = arr[0].getTotalPss();
            }
        } catch (Throwable ignored) { /* 用 Debug.getMemoryInfo 的结果 */ }
        JSObject ret = new JSObject();
        ret.put("totalPssKb", pss);
        ret.put("rssKb", readRssKb());
        ret.put("nativeHeapKb", Debug.getNativeHeapAllocatedSize() / 1024);
        ret.put("dalvikPssKb", self.dalvikPss);
        ret.put("nativePssKb", self.nativePss);
        call.resolve(ret);
    }

    @PluginMethod
    public void takePendingFile(PluginCall call) {
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        Uri uri = null;
        if (intent != null) {
            String action = intent.getAction();
            if (Intent.ACTION_VIEW.equals(action)) uri = intent.getData();
            else if (Intent.ACTION_SEND.equals(action)) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) {
            call.resolve(new JSObject());
            return;
        }
        try {
            String name = displayName(uri);
            if (!name.matches("(?i).+\\.(dwg|dxf)")) {
                call.reject("不是 DWG 或 DXF：" + name);
                return;
            }
            File dest = copyToCache(uri, name);
            JSObject ret = new JSObject();
            ret.put("path", dest.getAbsolutePath());
            ret.put("name", dest.getName());
            intent.setAction(Intent.ACTION_MAIN);
            intent.setData(null);
            intent.removeExtra(Intent.EXTRA_STREAM);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "复制文件失败" : e.getMessage());
        }
    }

    private String displayName(Uri uri) {
        String name = "opened.dwg";
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0 && c.getString(i) != null) name = c.getString(i);
            }
        } catch (Throwable ignored) { /* 用默认文件名 */ }
        name = name.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        if (name.isEmpty()) name = "opened.dwg";
        return name;
    }

    private File copyToCache(Uri uri, String name) throws Exception {
        File dir = new File(getContext().getCacheDir(), "incoming");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("无法建立缓存目录");
        File dest = new File(dir, name);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(dest)) {
            if (in == null) throw new Exception("无法打开 " + uri);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        }
        return dest;
    }

    private static int readRssKb() {
        try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader("/proc/self/status"))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("VmRSS:")) {
                    String[] parts = line.trim().split("\\s+");
                    if (parts.length >= 2) return Integer.parseInt(parts[1]);
                }
            }
        } catch (Throwable ignored) { /* 没有 RSS */ }
        return 0;
    }
}
