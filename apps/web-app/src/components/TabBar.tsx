import { Folder, GitBranch, Loader2, Plus, Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useServer } from "../contexts/ServerContext";
import type { Project } from "../contexts/ServerContext";
import { useInstanceInfo } from "../hooks/useWorktrees";
import { palette, surface } from "../theme";
import { Tooltip } from "./Tooltip";

interface TabBarProps {
  onOpenSettings?: () => void;
  onToggleNgrok?: () => void;
  onOpenNgrokQr?: () => void;
  ngrokEnabled?: boolean;
  ngrokBusy?: boolean;
  ngrokQrDisabled?: boolean;
  onOverlapChange?: (overlaps: boolean) => void;
}

export function TabBar({ onOpenSettings, onOverlapChange }: TabBarProps) {
  const {
    projects,
    activeProject,
    switchProject,
    closeProject,
    selectFolder,
    openProject,
    isElectron,
  } = useServer();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [overlaps, setOverlaps] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const instanceInfo = useInstanceInfo();

  const checkOverlap = useCallback(() => {
    if (!tabsRef.current) return;
    const tabsRight = tabsRef.current.getBoundingClientRect().right;
    // max-w-2xl = 672px, centered in viewport
    const contentLeft = (window.innerWidth - 672) / 2;
    setOverlaps(tabsRight > contentLeft);
  }, []);

  useEffect(() => {
    onOverlapChange?.(overlaps);
  }, [overlaps, onOverlapChange]);

  useEffect(() => {
    if (!isElectron || projects.length === 0) {
      setOverlaps(false);
      return;
    }
    checkOverlap();
    window.addEventListener("resize", checkOverlap);
    const observer = tabsRef.current ? new ResizeObserver(checkOverlap) : null;
    if (tabsRef.current) observer?.observe(tabsRef.current);
    return () => {
      window.removeEventListener("resize", checkOverlap);
      observer?.disconnect();
    };
  }, [isElectron, projects.length, checkOverlap]);

  useEffect(() => {
    if (
      !isElectron ||
      !window.electronAPI ||
      typeof window.electronAPI.getAppVersion !== "function"
    ) {
      setAppVersion(null);
      return;
    }

    window.electronAPI
      .getAppVersion()
      .then((version) => setAppVersion(version))
      .catch(() => {
        setAppVersion(null);
      });
  }, [isElectron]);

  // Only show in Electron mode with at least one project
  if (!isElectron || projects.length === 0) {
    return null;
  }

  const handleAddProject = async () => {
    const folderPath = await selectFolder();
    if (folderPath) {
      await openProject(folderPath);
    }
  };

  return (
    <div
      className={`flex-shrink-0 flex items-center z-40 pl-5 pr-4 pb-5 pt-4 gap-1 ${overlaps ? "bg-[#0c0e12]/60 backdrop-blur-md" : ""}`}
    >
      <div ref={tabsRef} className="flex items-center gap-1">
        {projects.map((project, index) => (
          <Tab
            key={project.id}
            project={project}
            index={index + 1}
            isActive={project.id === activeProject?.id}
            onSelect={() => switchProject(project.id)}
            onClose={() => closeProject(project.id)}
          />
        ))}

        {/* Add project button */}
        <Tooltip text="Open Project">
          <button
            onClick={handleAddProject}
            className="flex items-center justify-center w-7 h-7 rounded-md text-[#6b7280] hover:text-[#e5e7eb] hover:bg-white/[0.06] transition-colors duration-150"
          >
            <Plus className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      {/* Spacer */}
      <div className="ml-auto" />

      {/* {onOpenNgrokQr && (
        <Tooltip text="Generate Pairing QR">
          <button
            onClick={onOpenNgrokQr}
            disabled={ngrokBusy || ngrokQrDisabled}
            className="flex items-center justify-center w-7 h-7 rounded-md text-[#6b7280] hover:text-[#e5e7eb] hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            <QrCode className="w-4 h-4" />
          </button>
        </Tooltip>
      )}

      {onToggleNgrok && (
        <Tooltip text={ngrokEnabled ? "Disable Tunnel" : "Enable Tunnel"}>
          <button
            onClick={onToggleNgrok}
            disabled={ngrokBusy}
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
              ngrokEnabled
                ? "text-[#2dd4bf] bg-[#2dd4bf]/10 hover:bg-[#2dd4bf]/20"
                : "text-[#6b7280] hover:text-[#e5e7eb] hover:bg-white/[0.06]"
            }`}
          >
            {ngrokBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wifi className="w-4 h-4" />
            )}
          </button>
        </Tooltip>
      )} */}

      {(instanceInfo.branch || instanceInfo.port) && (
        <div
          className={`mr-4 h-7 inline-flex items-center gap-1.5 text-[10px] text-[${palette.text2}] font-mono select-text`}
        >
          <span className={`text-[${palette.text1}]`}>{instanceInfo.worktreeName ?? "root"}</span>
          {instanceInfo.branch && (
            <>
              <span className={`text-[${palette.text3}]`}>·</span>
              <GitBranch className="w-3 h-3 flex-shrink-0" />
              <span>{instanceInfo.branch}</span>
            </>
          )}
          {instanceInfo.port && (
            <span className={`text-[${palette.text3}] ml-0.5`}>:{instanceInfo.port}</span>
          )}
        </div>
      )}

      {onOpenSettings && appVersion && (
        <div className="mr-2 h-7 inline-flex items-center justify-center text-[10px] text-[#8f97a6]">
          v{appVersion}
        </div>
      )}

      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="flex items-center justify-center w-7 h-7 rounded-md text-[#6b7280] hover:text-[#e5e7eb] hover:bg-white/[0.06] transition-colors duration-150"
        >
          <Settings className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

interface TabProps {
  project: Project;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function Tab({ project, index, isActive, onSelect, onClose }: TabProps) {
  const isStarting = project.status === "starting";
  const hasError = project.status === "error";

  return (
    <div
      className={`
        group relative flex items-center gap-2 h-7 px-3 rounded-md cursor-pointer
        transition-colors duration-150
        ${
          isActive
            ? `${surface.panelSelected} text-[#6b7280]`
            : `text-[#6b7280] hover:bg-white/[0.04] ${hasError ? "" : "hover:text-[#9ca3af]"}`
        }
        ${hasError ? "text-red-400" : ""}
      `}
      onClick={onSelect}
    >
      {/* Icon */}
      {isStarting ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2dd4bf]" />
      ) : (
        <Folder className={`w-3.5 h-3.5 ${hasError ? "text-red-400" : ""}`} />
      )}

      {/* Project name */}
      <span className="text-xs font-medium truncate max-w-[120px]">{project.name}</span>

      {/* Tab number (visible when inactive) / Close button (visible on hover) */}
      <div className="relative flex items-center justify-center w-4 h-4 -mr-1">
        {!isActive && (
          <span
            className={`
              absolute inset-0 flex items-center justify-center rounded
              text-[10px] font-mono text-[#4b5563] bg-white/[0.06]
              group-hover:opacity-0 transition-opacity duration-150
            `}
          >
            {index}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={`
            absolute inset-0 flex items-center justify-center rounded
            opacity-0 group-hover:opacity-100
            hover:bg-white/10 ${hasError ? "" : "hover:text-[#e5e7eb]"} transition-all duration-150
          `}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
