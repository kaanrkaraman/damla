import Cocoa
import SafariServices
import ServiceManagement
import Sparkle

private let extensionID = "com.kaan.damla.Extension"
private let updateURLHost = "check-for-updates"

private enum Dialog {
    @discardableResult
    static func confirm(_ message: String, detail: String, accept: String, decline: String? = nil) -> Bool {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = detail
        alert.addButton(withTitle: accept)
        if let decline { alert.addButton(withTitle: decline) }
        return alert.runModal() == .alertFirstButtonReturn
    }
}

@MainActor
private final class HelperSupervisor {
    static let python: URL? = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("python/bin/python3"),
              FileManager.default.isExecutableFile(atPath: url.path)
        else { return nil }
        return url
    }()

    private static let healthyRunTime: TimeInterval = 30
    private static let maxDelay: TimeInterval = 60
    private static let baseDelay: TimeInterval = 2

    private var process: Process?
    private var startedAt = Date.distantPast
    private var delay = HelperSupervisor.baseDelay
    private var stopped = false

    var isRunning: Bool { process?.isRunning == true }

    func start() {
        guard !stopped, let python = Self.python, let resources = Bundle.main.resourceURL else { return }
        let process = Process()
        process.executableURL = python
        process.arguments = ["-B", "-I", resources.appendingPathComponent("helper/server.py").path]
        if let log = Self.openLog() {
            process.standardOutput = log
            process.standardError = log
        }
        process.terminationHandler = { [weak self] _ in
            Task { @MainActor in self?.didExit() }
        }
        do {
            try process.run()
            self.process = process
            startedAt = .now
        } catch {
            scheduleRestart()
        }
    }

    func stop() {
        stopped = true
        process?.terminate()
    }

    private func didExit() {
        process = nil
        delay = Date.now.timeIntervalSince(startedAt) > Self.healthyRunTime ? Self.baseDelay : min(delay * 2, Self.maxDelay)
        scheduleRestart()
    }

    private func scheduleRestart() {
        guard !stopped else { return }
        Task { [weak self, delay] in
            try? await Task.sleep(for: .seconds(delay))
            self?.start()
        }
    }

    private static func openLog() -> FileHandle? {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Damla.log")
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return nil }
        _ = try? handle.seekToEnd()
        return handle
    }
}

@MainActor
private enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    static func offer() {
        let service = SMAppService.mainApp
        switch service.status {
        case .notRegistered:
            register(service)
        case .requiresApproval:
            askApproval()
        case .enabled, .notFound:
            break
        @unknown default:
            break
        }
    }

    private static func register(_ service: SMAppService) {
        let allowed = Dialog.confirm(
            String(localized: "login.title"),
            detail: String(localized: "login.detail"),
            accept: String(localized: "login.allow"),
            decline: String(localized: "common.notNow")
        )
        guard allowed else { return }
        do {
            try service.register()
        } catch {
            Dialog.confirm(String(localized: "login.failed"), detail: error.localizedDescription, accept: String(localized: "common.ok"))
            return
        }
        if service.status == .requiresApproval { askApproval() }
    }

    private static func askApproval() {
        let open = Dialog.confirm(
            String(localized: "approval.title"),
            detail: String(localized: "approval.detail"),
            accept: String(localized: "approval.open"),
            decline: String(localized: "common.notNow")
        )
        if open { SMAppService.openSystemSettingsLoginItems() }
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
    private let helper = HelperSupervisor()

    private var runsFromDiskImage: Bool {
        let path = Bundle.main.bundlePath
        return path.hasPrefix("/Volumes/") || path.contains("/AppTranslocation/")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard !runsFromDiskImage else {
            NSApp.activate(ignoringOtherApps: true)
            Dialog.confirm(
                String(localized: "dmg.title"),
                detail: String(localized: "dmg.detail"),
                accept: String(localized: "common.ok")
            )
            NSApp.terminate(nil)
            return
        }
        let bundled = HelperSupervisor.python != nil
        helper.start()
        if bundled, !LoginItem.isEnabled {
            NSApp.activate(ignoringOtherApps: true)
            LoginItem.offer()
        }
        if !bundled || !LoginItem.isEnabled {
            offerExtension()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        helper.stop()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showStatus()
        return false
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: { $0.scheme == "damla" && $0.host == updateURLHost }) else { return }
        NSApp.activate(ignoringOtherApps: true)
        updater.checkForUpdates(nil)
    }

    private func offerExtension() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionID) { state, _ in
            Task { @MainActor in
                guard let state, !state.isEnabled else { return }
                let open = Dialog.confirm(
                    String(localized: "extension.title"),
                    detail: String(localized: "extension.detail"),
                    accept: String(localized: "extension.open"),
                    decline: String(localized: "common.notNow")
                )
                guard open else { return }
                do {
                    try await SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionID)
                } catch {
                    Dialog.confirm(String(localized: "extension.title"), detail: error.localizedDescription, accept: String(localized: "common.ok"))
                }
            }
        }
    }

    private func showStatus() {
        NSApp.activate(ignoringOtherApps: true)
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let alert = NSAlert()
        alert.messageText = String(localized: "status.title")
        let template = helper.isRunning ? String(localized: "status.running") : String(localized: "status.stopped")
        alert.informativeText = String(format: template, version)
        alert.addButton(withTitle: String(localized: "common.ok"))
        alert.addButton(withTitle: String(localized: "status.check"))
        alert.addButton(withTitle: String(localized: "status.quit"))
        switch alert.runModal() {
        case .alertSecondButtonReturn: updater.checkForUpdates(nil)
        case .alertThirdButtonReturn: NSApp.terminate(nil)
        default: break
        }
    }
}
