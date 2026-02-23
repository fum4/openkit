import claudeSvg from "./claude.svg?raw";
import codexSvg from "./codex.svg?raw";
import cursorSvg from "./cursor.svg?raw";
import finderAsset from "./finder.png";
import geminiSvg from "./gemini.svg?raw";
import ghosttySvg from "./ghostty.svg?raw";
import githubSvg from "./github.svg?raw";
import intellijSvg from "./intellij.svg?raw";
import jiraSvg from "./jira.svg?raw";
import linearSvg from "./linear.svg?raw";
import neovimSvg from "./neovim.svg?raw";
import opencodeSvg from "./opencode.svg?raw";
import terminalSvg from "./terminal.svg?raw";
import vscodeSvg from "./vscode.svg?raw";
import warpSvg from "./warp.svg?raw";
import webstormSvg from "./webstorm.svg?raw";
import zedSvg from "./zed.svg?raw";

export interface IconProps {
  className?: string;
}

interface AssetIconProps extends IconProps {
  src: string;
}

interface SvgIconProps extends IconProps {
  markup: string;
}

function AssetIcon({ src, className = "w-4 h-4" }: AssetIconProps) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={className}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

function SvgIcon({ markup, className = "w-4 h-4" }: SvgIconProps) {
  const normalizedMarkup = markup
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
      const cleanedAttrs = attrs
        .replace(/\s(width|height)=["'][^"']*["']/gi, "")
        .replace(/\sstyle=["'][^"']*["']/gi, "");
      return `<svg${cleanedAttrs} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" style="display:block">`;
    });

  return (
    <span
      aria-hidden="true"
      className={`inline-flex align-middle leading-none overflow-hidden ${className}`}
      dangerouslySetInnerHTML={{ __html: normalizedMarkup }}
    />
  );
}

export function ClaudeIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={claudeSvg} className={className} />;
}

export function CodexIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={codexSvg} className={className} />;
}

export function GeminiIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={geminiSvg} className={className} />;
}

export function OpenCodeIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={opencodeSvg} className={className} />;
}

export function GitHubIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={githubSvg} className={className} />;
}

export function JiraIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={jiraSvg} className={className} />;
}

export function LinearIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={linearSvg} className={className} />;
}

export function FinderIcon({ className = "w-4 h-4" }: IconProps) {
  return <AssetIcon src={finderAsset} className={className} />;
}

export function CursorIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={cursorSvg} className={className} />;
}

export function VSCodeIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={vscodeSvg} className={className} />;
}

export function ZedIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={zedSvg} className={className} />;
}

export function IntelliJIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={intellijSvg} className={className} />;
}

export function WebStormIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={webstormSvg} className={className} />;
}

export function TerminalIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={terminalSvg} className={className} />;
}

export function WarpIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={warpSvg} className={className} />;
}

export function GhosttyIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={ghosttySvg} className={className} />;
}

export function NeoVimIcon({ className = "w-4 h-4" }: IconProps) {
  return <SvgIcon markup={neovimSvg} className={className} />;
}
