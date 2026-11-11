package app.lightningpeek.shell;

import android.app.ActivityManager;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Debug;
import android.os.Process;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

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
        ret.put("rssKb", readRssKb(Process.myPid()));
        ret.put("nativeHeapKb", Debug.getNativeHeapAllocatedSize() / 1024);
        ret.put("dalvikPssKb", self.dalvikPss);
        ret.put("nativePssKb", self.nativePss);
        fillOtherProcesses(ret);
        call.resolve(ret);
    }

    @PluginMethod
    public void takePendingFile(PluginCall call) {
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        Uri uri = null;
        if (intent != null) {
            String action = intent.getAction();
            if (Intent.ACTION_VIEW.equals(action)) uri = intent.getData();
            else if (Intent.ACTION_SEND.equals(action)) uri = streamExtra(intent);
        }
        if (uri == null) {
            call.resolve(new JSObject());
            return;
        }
        try {
            File dest = copyToCache(uri);
            JSObject ret = new JSObject();
            ret.put("path", dest.getAbsolutePath());
            ret.put("name", dest.getName());
            intent.setAction(Intent.ACTION_MAIN);
            intent.setData(null);
            intent.removeExtra(Intent.EXTRA_STREAM);
            call.resolve(ret);
        } catch (Exception e) {
            Log.w("PeekProbe", "takePendingFile", e);
            call.reject(e.getMessage() == null ? "复制文件失败" : e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private Uri streamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
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

    private File copyToCache(Uri uri) throws Exception {
        File root = new File(getContext().getCacheDir(), "incoming");
        File dir = new File(root, String.valueOf(System.currentTimeMillis()));
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("无法建立缓存目录");
        File[] old = root.listFiles();
        if (old != null) for (File child : old) if (!child.equals(dir)) deleteRec(child);
        File tmp = new File(dir, "incoming.bin");
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(tmp)) {
            if (in == null) throw new Exception("无法打开 " + uri);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        }
        String name = finalName(uri, tmp);
        File dest = new File(dir, name);
        if (!tmp.renameTo(dest)) throw new Exception("无法命名缓存文件");
        return dest;
    }

    private String finalName(Uri uri, File tmp) throws Exception {
        String name = displayName(uri);
        if (name.matches("(?i).+\\.(dwg|dxf)$")) return name;
        String ext = extFromType(uri);
        if (ext == null) ext = extFromMagic(tmp);
        if (ext == null) throw new Exception("不是 DWG 或 DXF：" + name);
        if (name.toLowerCase().endsWith(ext)) return name;
        return name + ext;
    }

    private String extFromType(Uri uri) {
        String type = null;
        try { type = getContext().getContentResolver().getType(uri); } catch (Throwable ignored) { /* 没有类型 */ }
        if (type == null) return null;
        String t = type.toLowerCase();
        if (t.contains("dxf")) return ".dxf";
        if (t.contains("dwg") || t.contains("acad")) return ".dwg";
        return null;
    }

    private static String extFromMagic(File tmp) throws Exception {
        byte[] head = new byte[64];
        int n;
        try (FileInputStream in = new FileInputStream(tmp)) { n = in.read(head); }
        if (n >= 6) {
            String magic = new String(head, 0, 6, StandardCharsets.US_ASCII);
            if (magic.startsWith("AC10")) return ".dwg";
        }
        String text = new String(head, 0, Math.max(n, 0), StandardCharsets.US_ASCII).trim();
        if (text.startsWith("0") || text.startsWith("AutoCAD") || text.contains("SECTION")) return ".dxf";
        return null;
    }

    private void fillOtherProcesses(JSObject ret) {
        int self = Process.myPid();
        int extra = 0;
        int count = 0;
        StringBuilder note = new StringBuilder();
        File[] kids = new File("/proc").listFiles();
        if (kids == null) {
            ret.put("otherCount", 0);
            ret.put("otherRssKb", 0);
            ret.put("otherNote", "读不到 /proc，沙箱渲染进程的 PSS/RSS 没拿到");
            return;
        }
        String pkg = getContext().getPackageName();
        for (File f : kids) {
            if (!f.getName().matches("\\d+")) continue;
            int pid = Integer.parseInt(f.getName());
            if (pid == self) continue;
            String cmd = readCmd(pid);
            if (cmd == null) continue;
            if (!cmd.contains("sandboxed") && !cmd.contains(pkg)) continue;
            int rss = readRssKb(pid);
            if (rss <= 0 && !cmd.contains("sandboxed")) continue;
            extra += Math.max(rss, 0);
            count++;
            if (note.length() < 160) note.append(pid).append(' ').append(cmd.replace('\0', ' ').trim()).append("; ");
        }
        ret.put("otherCount", count);
        ret.put("otherRssKb", extra);
        ret.put("otherNote", count == 0
            ? "本进程之外没有读到沙箱渲染进程。真机用 adb shell dumpsys meminfo 和 ps -A | grep sandboxed"
            : note.toString());
    }

    private static String readCmd(int pid) {
        try (FileInputStream in = new FileInputStream("/proc/" + pid + "/cmdline")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[256];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Throwable ignored) { return null; }
    }

    private static void deleteRec(File f) {
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRec(k);
        }
        f.delete();
    }

    private static int readRssKb(int pid) {
        try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader("/proc/" + pid + "/status"))) {
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
