const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const pkg = "com.evrasia.hd";
const javaDir = ["android", "app", "src", "main", "java", ...pkg.split(".")];

function addSmsManifest(config) {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    if (!manifest["uses-permission"].some(p => p.$?.["android:name"] === "android.permission.RECEIVE_SMS")) {
      manifest["uses-permission"].push({ $: { "android:name": "android.permission.RECEIVE_SMS" } });
    }
    const app = manifest.application[0];
    app.receiver = app.receiver || [];
    if (!app.receiver.some(r => r.$?.["android:name"] === ".SmsCodeReceiver")) {
      app.receiver.push({
        $: { "android:name": ".SmsCodeReceiver", "android:exported": "true" },
        "intent-filter": [{
          $: { "android:priority": "999" },
          action: [{ $: { "android:name": "android.provider.Telephony.SMS_RECEIVED" } }]
        }]
      });
    }

    app.activity = app.activity || [];
    const mainActivity = app.activity.find(a => a.$?.["android:name"] === ".MainActivity");
    if (mainActivity) {
      mainActivity.$["android:theme"] = "@style/AppTheme";
      mainActivity["intent-filter"] = (mainActivity["intent-filter"] || []).filter(filter => {
        const isMain = (filter.action || []).some(a => a.$?.["android:name"] === "android.intent.action.MAIN");
        const isLauncher = (filter.category || []).some(c => c.$?.["android:name"] === "android.intent.category.LAUNCHER");
        return !(isMain && isLauncher);
      });
    }
    app.activity = app.activity.filter(a => a.$?.["android:name"] !== ".IntroActivity");
    app.activity.push({
      $: {
        "android:name": ".IntroActivity",
        "android:exported": "true",
        "android:screenOrientation": "portrait",
        "android:theme": "@style/AppTheme"
      },
      "intent-filter": [{
        action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
        category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }]
      }]
    });
    return config;
  });
}

function addNativeFiles(config) {
  return withDangerousMod(config, ["android", async config => {
    const root = config.modRequest.projectRoot;
    const dir = path.join(root, ...javaDir);
    fs.mkdirSync(dir, { recursive: true });

    const rawDir = path.join(root, "android", "app", "src", "main", "res", "raw");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.copyFileSync(path.join(root, "assets", "evrasia_hd_glitch.mp4"), path.join(rawDir, "evrasia_hd_glitch.mp4"));

    fs.writeFileSync(path.join(dir, "SmsCodeReceiver.kt"), `package ${pkg}\n\nimport android.content.BroadcastReceiver\nimport android.content.Context\nimport android.content.Intent\nimport android.provider.Telephony\nimport android.content.ClipData\nimport android.content.ClipboardManager\n\nclass SmsCodeReceiver : BroadcastReceiver() {\n  override fun onReceive(context: Context, intent: Intent) {\n    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return\n    val prefs = context.getSharedPreferences("evrasia_sms", Context.MODE_PRIVATE)\n    val until = prefs.getLong("waiting_until", 0L)\n    if (until < System.currentTimeMillis()) return\n    val body = Telephony.Sms.Intents.getMessagesFromIntent(intent).joinToString("") { it.messageBody ?: "" }\n    val code = Regex("(?<!\\\\d)(\\\\d{4})(?!\\\\d)").find(body)?.groupValues?.get(1) ?: return\n    val checkin = prefs.getString("checkin", "") ?: ""\n    val text = "чекин: " + checkin + ", на списание: " + code\n    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager\n    clipboard.setPrimaryClip(ClipData.newPlainText("Евразия hd", text))\n    prefs.edit().putString("last_code", code).putString("last_result", text).putLong("received_at", System.currentTimeMillis()).remove("waiting_until").apply()\n  }\n}\n`);

    fs.writeFileSync(path.join(dir, "SmsCodeModule.kt"), `package ${pkg}\n\nimport android.Manifest\nimport android.content.Context\nimport android.content.pm.PackageManager\nimport com.facebook.react.bridge.Promise\nimport com.facebook.react.bridge.ReactApplicationContext\nimport com.facebook.react.bridge.ReactContextBaseJavaModule\nimport com.facebook.react.bridge.ReactMethod\nimport com.facebook.react.modules.core.PermissionAwareActivity\nimport com.facebook.react.modules.core.PermissionListener\n\nclass SmsCodeModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {\n  override fun getName() = "SmsCode"\n\n  @ReactMethod\n  fun ensurePermission(promise: Promise) {\n    if (ctx.checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED) { promise.resolve(true); return }\n    val activity = ctx.currentActivity as? PermissionAwareActivity\n    if (activity == null) { promise.reject("NO_ACTIVITY", "Не удалось запросить разрешение на получение SMS"); return }\n    activity.requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS), 8421, PermissionListener { _, _, grantResults ->\n      promise.resolve(grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED); true\n    })\n  }\n\n  @ReactMethod\n  fun startWaiting(checkin: String, promise: Promise) {\n    ctx.getSharedPreferences("evrasia_sms", Context.MODE_PRIVATE).edit().putString("checkin", checkin).putLong("waiting_until", System.currentTimeMillis() + 180000L).remove("last_code").remove("last_result").apply()\n    promise.resolve(true)\n  }\n}\n`);

    fs.writeFileSync(path.join(dir, "AppearanceMediaModule.kt"), `package ${pkg}\n\nimport android.app.Activity\nimport android.content.Context\nimport android.content.Intent\nimport android.content.pm.ShortcutInfo\nimport android.content.pm.ShortcutManager\nimport android.graphics.BitmapFactory\nimport android.graphics.drawable.Icon\nimport android.net.Uri\nimport android.os.Build\nimport com.facebook.react.bridge.BaseActivityEventListener\nimport com.facebook.react.bridge.Promise\nimport com.facebook.react.bridge.ReactApplicationContext\nimport com.facebook.react.bridge.ReactContextBaseJavaModule\nimport com.facebook.react.bridge.ReactMethod\nimport com.facebook.react.bridge.WritableNativeMap\nimport java.io.File\n\nclass AppearanceMediaModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {\n  private var pendingPromise: Promise? = null\n  private var pendingKind: String? = null\n  private val prefs by lazy { ctx.getSharedPreferences("evrasia_appearance", Context.MODE_PRIVATE) }\n\n  private val listener = object : BaseActivityEventListener() {\n    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {\n      if (requestCode !in 8431..8433) return\n      val promise = pendingPromise ?: return\n      val kind = pendingKind ?: return\n      pendingPromise = null\n      pendingKind = null\n      if (resultCode != Activity.RESULT_OK || data?.data == null) { promise.resolve(null); return }\n      try {\n        val file = copyPicked(data.data!!, kind)\n        val uri = Uri.fromFile(file).toString()\n        prefs.edit().putString(kind + "_uri", uri).apply()\n        if (kind == "icon") pinShortcut(file)\n        promise.resolve(uri)\n      } catch (e: Exception) {\n        promise.reject("MEDIA_PICK", e.message ?: "Не удалось сохранить файл", e)\n      }\n    }\n  }\n\n  init { ctx.addActivityEventListener(listener) }\n  override fun getName() = "AppearanceMedia"\n\n  override fun getConstants(): MutableMap<String, Any> = hashMapOf("appVersion" to BuildConfig.VERSION_NAME)\n\n  private fun startPicker(kind: String, mime: String, requestCode: Int, promise: Promise) {\n    if (pendingPromise != null) { promise.reject("PICKER_BUSY", "Уже открыт выбор файла"); return }\n    val activity = ctx.currentActivity\n    if (activity == null) { promise.reject("NO_ACTIVITY", "Не удалось открыть выбор файла"); return }\n    pendingPromise = promise\n    pendingKind = kind\n    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {\n      addCategory(Intent.CATEGORY_OPENABLE)\n      type = mime\n      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)\n    }\n    activity.startActivityForResult(intent, requestCode)\n  }\n\n  private fun copyPicked(uri: Uri, kind: String): File {\n    val mime = ctx.contentResolver.getType(uri) ?: ""\n    val ext = when {\n      mime.contains("png") -> "png"\n      mime.contains("jpeg") || mime.contains("jpg") -> "jpg"\n      mime.contains("webp") -> "webp"\n      mime.contains("gif") -> "gif"\n      mime.contains("webm") -> "webm"\n      mime.contains("quicktime") -> "mov"\n      mime.contains("mp4") -> "mp4"\n      kind == "video" -> "mp4"\n      else -> "img"\n    }\n    val dir = File(ctx.filesDir, "appearance").apply { mkdirs() }\n    dir.listFiles()?.filter { it.name.startsWith(kind + ".") || it.name.startsWith(kind + "_") }?.forEach { it.delete() }\n    val file = File(dir, kind + "_" + System.currentTimeMillis() + "." + ext)\n    val input = ctx.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Файл недоступен")\n    input.use { source -> file.outputStream().use { target -> source.copyTo(target) } }\n    return file\n  }\n\n  private fun pinShortcut(file: File) {\n    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return\n    val manager = ctx.getSystemService(ShortcutManager::class.java) ?: return\n    if (!manager.isRequestPinShortcutSupported) return\n    val bitmap = BitmapFactory.decodeFile(file.absolutePath) ?: throw IllegalArgumentException("Выбранное изображение не распознано")\n    val intent = Intent(ctx, IntroActivity::class.java).apply { action = Intent.ACTION_MAIN; addCategory(Intent.CATEGORY_LAUNCHER) }\n    val shortcut = ShortcutInfo.Builder(ctx, "evrasia-hd-custom-icon")\n      .setShortLabel("Евразия hd")\n      .setLongLabel("Евразия hd")\n      .setIcon(Icon.createWithBitmap(bitmap))\n      .setIntent(intent)\n      .build()\n    manager.requestPinShortcut(shortcut, null)\n  }\n\n  @ReactMethod fun getSettings(promise: Promise) {\n    val map = WritableNativeMap()\n    map.putString("logoUri", prefs.getString("logo_uri", "") ?: "")\n    map.putString("videoUri", prefs.getString("video_uri", "") ?: "")\n    map.putString("iconUri", prefs.getString("icon_uri", "") ?: "")\n    promise.resolve(map)\n  }\n  @ReactMethod fun pickLogo(promise: Promise) = startPicker("logo", "image/*", 8431, promise)\n  @ReactMethod fun pickVideo(promise: Promise) = startPicker("video", "video/*", 8432, promise)\n  @ReactMethod fun pickLauncherIcon(promise: Promise) = startPicker("icon", "image/*", 8433, promise)\n\n  @ReactMethod fun reset(kind: String, promise: Promise) {\n    val key = when (kind) { "logo" -> "logo_uri"; "video" -> "video_uri"; "icon" -> "icon_uri"; else -> "" }\n    if (key.isEmpty()) { promise.reject("BAD_KIND", "Неизвестный тип оформления"); return }\n    prefs.edit().remove(key).apply()\n    File(ctx.filesDir, "appearance").listFiles()?.filter { it.name.startsWith(kind + ".") || it.name.startsWith(kind + "_") }?.forEach { it.delete() }\n    promise.resolve(true)\n  }\n}\n`);

    fs.writeFileSync(path.join(dir, "IntroActivity.kt"), `package ${pkg}\n\nimport android.app.Activity\nimport android.content.Intent\nimport android.graphics.Color\nimport android.net.Uri\nimport android.os.Bundle\nimport android.os.Handler\nimport android.os.Looper\nimport android.view.Gravity\nimport android.view.ViewGroup\nimport android.widget.FrameLayout\nimport android.widget.VideoView\nimport java.io.File\n\nclass IntroActivity : Activity() {\n  private val handler = Handler(Looper.getMainLooper())\n  private var videoView: VideoView? = null\n  private var mainOpened = false\n\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n    window.statusBarColor = Color.rgb(8, 19, 16)\n    window.navigationBarColor = Color.rgb(8, 19, 16)\n\n    val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(8, 19, 16)) }\n    val video = VideoView(this)\n    videoView = video\n    root.addView(video, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER))\n    setContentView(root)\n\n    val defaultUri = Uri.parse("android.resource://" + packageName + "/" + R.raw.evrasia_hd_glitch)\n    val stored = getSharedPreferences("evrasia_appearance", MODE_PRIVATE).getString("video_uri", "") ?: ""\n    val storedUri = stored.takeIf { it.isNotBlank() }?.let(Uri::parse)\n    val storedFile = storedUri?.path?.let(::File)\n    val firstUri = if (storedFile?.isFile == true) Uri.fromFile(storedFile) else defaultUri\n    val firstIsCustom = storedFile?.isFile == true\n\n    fun play(source: Uri, canFallback: Boolean) {\n      video.setOnPreparedListener { player ->\n        player.isLooping = false\n        player.setVolume(0f, 0f)\n        video.start()\n      }\n      video.setOnCompletionListener { openMain() }\n      video.setOnErrorListener { _, _, _ ->\n        if (canFallback) play(defaultUri, false) else openMain()\n        true\n      }\n      try {\n        video.setVideoURI(source)\n      } catch (_: Exception) {\n        if (canFallback) play(defaultUri, false) else openMain()\n      }\n    }\n\n    play(firstUri, firstIsCustom)\n    handler.postDelayed({ openMain() }, 30000L)\n  }\n\n  private fun openMain() {\n    if (mainOpened) return\n    mainOpened = true\n    handler.removeCallbacksAndMessages(null)\n    startActivity(Intent(this, MainActivity::class.java))\n    finish()\n  }\n\n  override fun onDestroy() {\n    handler.removeCallbacksAndMessages(null)\n    videoView?.stopPlayback()\n    videoView = null\n    super.onDestroy()\n  }\n}\n`);

    fs.writeFileSync(path.join(dir, "SmsCodePackage.kt"), `package ${pkg}\n\nimport com.facebook.react.ReactPackage\nimport com.facebook.react.bridge.NativeModule\nimport com.facebook.react.bridge.ReactApplicationContext\nimport com.facebook.react.uimanager.ViewManager\n\nclass SmsCodePackage : ReactPackage {\n  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(SmsCodeModule(reactContext), AppearanceMediaModule(reactContext))\n  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()\n}\n`);

    const mainApp = path.join(dir, "MainApplication.kt");
    if (fs.existsSync(mainApp)) {
      let s = fs.readFileSync(mainApp, "utf8");
      if (!s.includes("SmsCodePackage()")) {
        s = s.replace(/PackageList\(this\)\.packages\.apply \{/, 'PackageList(this).packages.apply {\n              add(SmsCodePackage())');
        fs.writeFileSync(mainApp, s);
      }
    }

    return config;
  }]);
}

module.exports = function withSmsCode(config) {
  config = addSmsManifest(config);
  config = addNativeFiles(config);
  return config;
};
