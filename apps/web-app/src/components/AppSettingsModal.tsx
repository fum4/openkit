import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Settings } from "lucide-react";

import { DEFAULT_PORT } from "@openkit/shared/constants";
import { reportPersistentErrorToast } from "../errorToasts";
import { Modal } from "./Modal";
import { ToggleSwitch } from "./ToggleSwitch";
import { button, input, settings, text } from "../theme";

interface AppSettingsModalProps {
  onClose: () => void;
}

export function AppSettingsModal({ onClose }: AppSettingsModalProps) {
  const [basePort, setBasePort] = useState(DEFAULT_PORT);
  const [setupPreference, setSetupPreference] = useState<"ask" | "auto" | "manual">("ask");
  const [autoDownloadUpdates, setAutoDownloadUpdates] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [devModeRepoPath, setDevModeRepoPath] = useState("");
  const [initialBasePort, setInitialBasePort] = useState(DEFAULT_PORT);
  const [initialSetupPreference, setInitialSetupPreference] = useState<"ask" | "auto" | "manual">(
    "ask",
  );
  const [initialAutoDownloadUpdates, setInitialAutoDownloadUpdates] = useState(true);
  const [initialDevMode, setInitialDevMode] = useState(false);
  const [initialDevModeRepoPath, setInitialDevModeRepoPath] = useState("");
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    window.electronAPI
      ?.getPreferences()
      .then((prefs) => {
        setBasePort(prefs.basePort);
        setSetupPreference(prefs.setupPreference);
        setAutoDownloadUpdates(prefs.autoDownloadUpdates ?? true);
        setDevMode(prefs.devMode ?? false);
        setDevModeRepoPath(prefs.devModeRepoPath ?? "");
        setInitialBasePort(prefs.basePort);
        setInitialSetupPreference(prefs.setupPreference);
        setInitialAutoDownloadUpdates(prefs.autoDownloadUpdates ?? true);
        setInitialDevMode(prefs.devMode ?? false);
        setInitialDevModeRepoPath(prefs.devModeRepoPath ?? "");
      })
      .catch((error) => {
        reportPersistentErrorToast(error, "Failed to load app preferences", {
          scope: "app-settings:load-preferences",
        });
      });
  }, []);

  const hasChanges =
    basePort !== initialBasePort ||
    setupPreference !== initialSetupPreference ||
    autoDownloadUpdates !== initialAutoDownloadUpdates ||
    devMode !== initialDevMode ||
    devModeRepoPath !== initialDevModeRepoPath;

  const handleSave = async () => {
    try {
      await window.electronAPI?.updatePreferences({
        basePort,
        setupPreference,
        autoDownloadUpdates,
        devMode,
        devModeRepoPath,
      });
      onClose();
    } catch (error) {
      reportPersistentErrorToast(error, "Failed to save app preferences", {
        scope: "app-settings:save-preferences",
      });
    }
  };

  const handleToggleDevMode = async () => {
    const enabling = !devMode;
    setDevMode(enabling);

    if (enabling && !devModeRepoPath) {
      setDetecting(true);
      try {
        const detected = await window.electronAPI?.detectOpenkitRepo();
        if (detected) {
          setDevModeRepoPath(detected);
        }
      } catch (error) {
        reportPersistentErrorToast(error, "Failed to detect OpenKit repo", {
          scope: "app-settings:detect-repo",
        });
      } finally {
        setDetecting(false);
      }
    }
  };

  const handleBrowseRepo = async () => {
    const folder = await window.electronAPI?.selectDevRepoFolder();
    if (folder) {
      setDevModeRepoPath(folder);
    }
  };

  const fieldInputClass = `w-full px-2.5 py-1.5 rounded-md text-xs bg-white/[0.04] border border-white/[0.06] ${input.text} placeholder-[#4b5563] focus:outline-none focus:bg-white/[0.06] focus:border-white/[0.15] transition-all duration-150`;

  return (
    <Modal
      title="App Settings"
      icon={<Settings className="w-5 h-5 text-[#9ca3af]" />}
      onClose={onClose}
      width="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 text-xs rounded-lg ${text.muted} hover:${text.secondary} transition-colors`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges}
            className={`px-4 py-1.5 text-xs font-medium ${button.primary} rounded-lg disabled:opacity-50 transition-colors duration-150`}
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label className={`text-xs font-medium ${settings.label}`}>Base Server Port</label>
          <span className={`text-[11px] ${settings.description}`}>
            Starting port for project servers
          </span>
          <input
            type="number"
            value={basePort}
            onChange={(e) => setBasePort(parseInt(e.target.value, 10) || DEFAULT_PORT)}
            className={fieldInputClass}
          />
          <span className={`text-[10px] ${text.dimmed}`}>
            Takes effect for newly opened projects
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={`text-xs font-medium ${settings.label}`}>New Project Setup</label>
          <span className={`text-[11px] ${settings.description}`}>
            How to handle projects without configuration
          </span>
          <select
            value={setupPreference}
            onChange={(e) => setSetupPreference(e.target.value as "ask" | "auto" | "manual")}
            className={fieldInputClass}
          >
            <option value="ask">Ask every time</option>
            <option value="auto">Auto-detect settings</option>
            <option value="manual">Show setup form</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <label className={`text-xs font-medium ${settings.label}`}>Auto-download Updates</label>
            <span className={`text-[11px] ${settings.description}`}>
              Download new app versions in the background when available
            </span>
          </div>
          <ToggleSwitch
            checked={autoDownloadUpdates}
            onToggle={() => setAutoDownloadUpdates((prev) => !prev)}
            ariaLabel="Auto-download updates"
            size="md"
            checkedTrackClassName="bg-accent/35"
            uncheckedTrackClassName="bg-white/[0.08]"
            checkedThumbClassName="bg-accent"
            uncheckedThumbClassName="bg-white/40"
          />
        </div>

        <div className="border-t border-white/[0.06] pt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className={`text-xs font-medium ${settings.label}`}>Dev Mode</label>
              <span className={`text-[11px] ${settings.description}`}>
                Symlink project ops-logs into the OpenKit repo for debugging
              </span>
            </div>
            <ToggleSwitch
              checked={devMode}
              onToggle={handleToggleDevMode}
              ariaLabel="Dev mode"
              size="md"
              checkedTrackClassName="bg-accent/35"
              uncheckedTrackClassName="bg-white/[0.08]"
              checkedThumbClassName="bg-accent"
              uncheckedThumbClassName="bg-white/40"
            />
          </div>

          {devMode && (
            <div className="flex flex-col gap-1.5">
              <label className={`text-xs font-medium ${settings.label}`}>OpenKit Repo Path</label>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={devModeRepoPath}
                    onChange={(e) => setDevModeRepoPath(e.target.value)}
                    placeholder={detecting ? "" : "/path/to/openkit"}
                    disabled={detecting}
                    className={`${fieldInputClass} w-full ${detecting ? "opacity-50" : ""}`}
                  />
                  {detecting && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Loader2 className={`w-3.5 h-3.5 ${text.muted} animate-spin`} />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleBrowseRepo}
                  disabled={detecting}
                  className={`px-2 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md ${text.muted} hover:bg-white/[0.08] hover:${text.secondary} transition-colors disabled:opacity-50 shrink-0`}
                  title="Browse"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className={`text-[10px] ${text.dimmed}`}>
                Ops-logs will be symlinked to .openkit/ops-log/ in this repo
              </span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
