import Cocoa
import SafariServices
import ServiceManagement
import Sparkle

private let extensionID = "com.kaan.damla.Extension"

private enum L {
    static let turkish = Locale.preferredLanguages.first?.hasPrefix("tr") == true

    static func t(_ tr: String, _ en: String) -> String {
        turkish ? tr : en
    }
}

@main
enum Launcher {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    private var helper: Process?
    private var helperStartedAt = Date.distantPast
    private var restartDelay: TimeInterval = 2
    private var quitting = false

    private var bundledPython: URL? {
        guard let python = Bundle.main.resourceURL?.appendingPathComponent("python/bin/python3"),
              FileManager.default.isExecutableFile(atPath: python.path)
        else { return nil }
        return python
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if runsFromDiskImage() {
            NSApp.activate(ignoringOtherApps: true)
            _ = ask(
                L.t("Önce Applications klasörüne taşıyın", "Move it to Applications first"),
                L.t("Damla'yı Uygulamalar klasörüne sürükleyip oradan açın.", "Drag Damla to your Applications folder and open it from there."),
                L.t("Tamam", "OK"),
                nil
            )
            NSApp.terminate(nil)
            return
        }
        startHelper()
        if bundledPython != nil, SMAppService.mainApp.status != .enabled {
            NSApp.activate(ignoringOtherApps: true)
            offerLoginItem()
        }
        if SMAppService.mainApp.status != .enabled || bundledPython == nil {
            offerExtension()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        helper?.terminate()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showStatus()
        return false
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: { $0.scheme == "damla" && $0.host == "check-for-updates" }) else { return }
        NSApp.activate(ignoringOtherApps: true)
        updater.checkForUpdates(nil)
    }

    private func runsFromDiskImage() -> Bool {
        let path = Bundle.main.bundlePath
        return path.hasPrefix("/Volumes/") || path.contains("/AppTranslocation/")
    }

    private func startHelper() {
        guard !quitting, let python = bundledPython, let resources = Bundle.main.resourceURL else { return }
        let process = Process()
        process.executableURL = python
        process.arguments = ["-I", resources.appendingPathComponent("helper/server.py").path]
        if let log = logHandle() {
            process.standardOutput = log
            process.standardError = log
        }
        process.terminationHandler = { [weak self] _ in
            Task { @MainActor [weak self] in self?.helperExited() }
        }
        do {
            try process.run()
            helper = process
            helperStartedAt = Date()
        } catch {
            scheduleRestart()
        }
    }

    private func helperExited() {
        helper = nil
        restartDelay = Date().timeIntervalSince(helperStartedAt) > 30 ? 2 : min(restartDelay * 2, 60)
        scheduleRestart()
    }

    private func scheduleRestart() {
        guard !quitting else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + restartDelay) { [weak self] in
            self?.startHelper()
        }
    }

    private func logHandle() -> FileHandle? {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Damla.log")
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return nil }
        _ = try? handle.seekToEnd()
        return handle
    }

    private func offerLoginItem() {
        let service = SMAppService.mainApp
        switch service.status {
        case .notRegistered:
            let allow = ask(
                L.t("Damla oturum açılınca arka planda başlasın mı?", "Start Damla when you log in?"),
                L.t(
                    "Damla, videoları indiren küçük bir yardımcıyı arka planda çalıştırır. Mac'inize girişte kendiliğinden açılmasına izin verirseniz Terminal'e gerek kalmaz. Sistem Ayarları › Genel › Giriş Öğeleri'nden istediğiniz zaman kapatabilirsiniz.",
                    "Damla runs a small helper in the background that downloads videos. Let it open automatically when you log in. You can turn it off any time in System Settings › General › Login Items."
                ),
                L.t("Başlat", "Allow"),
                L.t("Şimdi değil", "Not Now")
            )
            guard allow else { return }
            do {
                try service.register()
            } catch {
                _ = ask(L.t("Başlatılamadı", "Couldn't turn it on"), error.localizedDescription, L.t("Tamam", "OK"), nil)
                return
            }
            if service.status == .requiresApproval { askApproval() }
        case .requiresApproval:
            askApproval()
        default:
            break
        }
    }

    private func askApproval() {
        let open = ask(
            L.t("Sistem Ayarları'nda izin verin", "Allow it in System Settings"),
            L.t("Giriş Öğeleri'nde “Damla” için arka plan iznini açın.", "Turn on Damla under Login Items."),
            L.t("Ayarları Aç", "Open Settings"),
            L.t("Şimdi değil", "Not Now")
        )
        if open { SMAppService.openSystemSettingsLoginItems() }
    }

    private func offerExtension() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionID) { state, _ in
            Task { @MainActor in
                guard let state, !state.isEnabled else { return }
                let open = self.ask(
                    L.t("Eklentiyi Safari'de açın", "Turn on the extension in Safari"),
                    L.t(
                        "Safari Ayarları › Uzantılar bölümünde “Damla”yı etkinleştirin ve kullandığınız sitelere erişim izni verin.",
                        "In Safari Settings › Extensions, enable Damla and allow it on the sites you use."
                    ),
                    L.t("Safari Ayarlarını Aç", "Open Safari Settings"),
                    L.t("Şimdi değil", "Not Now")
                )
                if open { try? await SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionID) }
            }
        }
    }

    private func showStatus() {
        NSApp.activate(ignoringOtherApps: true)
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let running = helper?.isRunning == true
        let alert = NSAlert()
        alert.messageText = L.t("Damla çalışıyor", "Damla is running")
        alert.informativeText = running
            ? L.t("Sürüm \(version). Yardımcı arka planda çalışıyor.", "Version \(version). The helper is running in the background.")
            : L.t("Sürüm \(version). Yardımcı şu an çalışmıyor.", "Version \(version). The helper is not running right now.")
        alert.addButton(withTitle: L.t("Tamam", "OK"))
        alert.addButton(withTitle: L.t("Güncellemeleri Denetle", "Check for Updates"))
        alert.addButton(withTitle: L.t("Damla'yı Kapat", "Quit Damla"))
        switch alert.runModal() {
        case .alertSecondButtonReturn: updater.checkForUpdates(nil)
        case .alertThirdButtonReturn: NSApp.terminate(nil)
        default: break
        }
    }

    private func ask(_ message: String, _ detail: String, _ yes: String, _ no: String?) -> Bool {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = detail
        alert.addButton(withTitle: yes)
        if let no { alert.addButton(withTitle: no) }
        return alert.runModal() == .alertFirstButtonReturn
    }
}
