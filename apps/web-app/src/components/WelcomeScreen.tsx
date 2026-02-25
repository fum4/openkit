import { useState, useCallback, useRef } from "react";
import { GitBranch, Layers, ListTodo, Bot, Rocket } from "lucide-react";

import { APP_NAME } from "@openkit/shared/constants";

interface WelcomeScreenProps {
  onImportProject: () => void;
}

// Animated branching visualization component
function BranchVisualization() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg
        className="absolute w-full h-full opacity-[0.07]"
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Main trunk */}
        <path
          d="M 400 600 L 400 350"
          stroke="url(#branchGradient)"
          strokeWidth="3"
          fill="none"
          className="animate-draw-line"
          style={{ animationDelay: "0s" }}
        />
        {/* Branch left 1 */}
        <path
          d="M 400 450 Q 350 420 280 380"
          stroke="url(#branchGradient)"
          strokeWidth="2"
          fill="none"
          className="animate-draw-line"
          style={{ animationDelay: "0.3s" }}
        />
        {/* Branch right 1 */}
        <path
          d="M 400 400 Q 480 370 550 340"
          stroke="url(#branchGradient)"
          strokeWidth="2"
          fill="none"
          className="animate-draw-line"
          style={{ animationDelay: "0.5s" }}
        />
        {/* Branch left 2 */}
        <path
          d="M 280 380 L 220 320"
          stroke="url(#branchGradient)"
          strokeWidth="1.5"
          fill="none"
          className="animate-draw-line"
          style={{ animationDelay: "0.7s" }}
        />
        {/* Branch right 2 */}
        <path
          d="M 550 340 Q 600 300 620 250"
          stroke="url(#branchGradient)"
          strokeWidth="1.5"
          fill="none"
          className="animate-draw-line"
          style={{ animationDelay: "0.9s" }}
        />
        {/* Additional decorative branches */}
        <path
          d="M 400 350 Q 420 300 450 260"
          stroke="url(#branchGradient)"
          strokeWidth="2"
          fill="none"
          className="animate-draw-line"
          style={{ animationDelay: "1.1s" }}
        />
        <path
          d="M 280 380 Q 260 340 240 280"
          stroke="url(#branchGradient)"
          strokeWidth="1"
          fill="none"
          className="animate-draw-line"
          style={{ animationDelay: "1.3s" }}
        />

        {/* Commit dots */}
        <circle
          cx="400"
          cy="450"
          r="6"
          fill="#2dd4bf"
          className="animate-pulse-dot"
          style={{ animationDelay: "0.4s" }}
        />
        <circle
          cx="400"
          cy="400"
          r="5"
          fill="#2dd4bf"
          className="animate-pulse-dot"
          style={{ animationDelay: "0.6s" }}
        />
        <circle
          cx="280"
          cy="380"
          r="5"
          fill="#2dd4bf"
          className="animate-pulse-dot"
          style={{ animationDelay: "0.8s" }}
        />
        <circle
          cx="550"
          cy="340"
          r="5"
          fill="#2dd4bf"
          className="animate-pulse-dot"
          style={{ animationDelay: "1s" }}
        />
        <circle
          cx="400"
          cy="350"
          r="6"
          fill="#2dd4bf"
          className="animate-pulse-dot"
          style={{ animationDelay: "1.2s" }}
        />
        <circle
          cx="220"
          cy="320"
          r="4"
          fill="#2dd4bf"
          className="animate-pulse-dot"
          style={{ animationDelay: "1.4s" }}
        />
        <circle
          cx="620"
          cy="250"
          r="4"
          fill="#2dd4bf"
          className="animate-pulse-dot"
          style={{ animationDelay: "1.5s" }}
        />
        <circle
          cx="450"
          cy="260"
          r="4"
          fill="#2dd4bf"
          className="animate-pulse-dot"
          style={{ animationDelay: "1.6s" }}
        />

        <defs>
          <linearGradient id="branchGradient" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.2" />
          </linearGradient>
        </defs>
      </svg>

      {/* Floating particles */}
      <div className="absolute inset-0">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-accent/30 animate-float-particle"
            style={{
              left: `${15 + ((i * 7) % 70)}%`,
              top: `${20 + ((i * 11) % 60)}%`,
              animationDelay: `${i * 0.4}s`,
              animationDuration: `${4 + (i % 3)}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  color,
  delay,
}: {
  icon: typeof GitBranch;
  title: string;
  description: string;
  color: string;
  delay: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative p-4 rounded-xl bg-white/[0.02] border transition-all duration-300 animate-fade-slide-up"
      style={{
        animationDelay: `${delay}ms`,
        borderColor: hovered
          ? `color-mix(in srgb, ${color} 35%, transparent)`
          : "rgba(255,255,255,0.06)",
        backgroundColor: hovered ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 p-2 rounded-lg transition-colors duration-300"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} ${hovered ? 18 : 12}%, transparent)`,
            color,
          }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-[#f0f2f5] mb-1">{title}</h3>
          <p className="text-[11px] text-[#6b7280] leading-relaxed whitespace-pre-line">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

export function WelcomeScreen({ onImportProject }: WelcomeScreenProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const skipTransition = useRef(false);

  const features = [
    {
      icon: GitBranch,
      title: "Worktrees",
      description: "Manage multiple worktrees side by side with automatic port isolation",
      color: "#2dd4bf", // teal-400
    },
    {
      icon: ListTodo,
      title: "Tasks",
      description:
        "Track work from Jira, Linear, or local tasks and link them directly to worktrees",
      color: "#fbbf24", // amber-400
    },
    {
      icon: Bot,
      title: "Agent Management",
      description:
        "Connect any AI agent to collaborate on worktrees and issues.\nManage all agent tooling — skills, plugins, hooks, and rules — in one place",
      color: "#a78bfa", // purple-400
    },
  ];

  const handleLaunch = useCallback(() => {
    if (isLaunching) return;
    setIsLaunching(true);
    setTimeout(() => {
      onImportProject();
    }, 600);
  }, [isLaunching, onImportProject]);

  return (
    <div className="flex-1 flex items-center justify-center bg-surface-page relative overflow-hidden">
      {/* Background visualization */}
      <BranchVisualization />

      {/* Radial gradient overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_#0c0e12_70%)]" />

      {/* Content */}
      <div className="relative z-10 max-w-xl w-full mx-auto px-8 py-12">
        {/* Logo & Title */}
        <div className="text-center mb-10 animate-fade-slide-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 mb-6 shadow-[0_0_40px_rgba(45,212,191,0.15)]">
            <Layers className="w-8 h-8 text-accent" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-semibold text-[#f0f2f5] tracking-tight mb-2">
            Welcome to <span className="text-accent">{APP_NAME}</span>
          </h1>
          <p className="text-[13px] text-[#6b7280] max-w-sm mx-auto leading-relaxed">
            Productivity's best friend
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid gap-3 mb-10">
          {features.map((feature, i) => (
            <FeatureCard
              key={feature.title}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              color={feature.color}
              delay={100 + i * 80}
            />
          ))}
        </div>

        {/* Import Button */}
        <div className="animate-fade-slide-up" style={{ animationDelay: "600ms" }}>
          <button
            onClick={handleLaunch}
            onMouseEnter={() => {
              if (isLaunching) {
                // Snap to bottom-left instantly (no transition), then animate in
                setIsLaunching(false);
                skipTransition.current = true;
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    skipTransition.current = false;
                    setIsHovering(true);
                  });
                });
              } else {
                setIsHovering(true);
              }
            }}
            onMouseLeave={() => setIsHovering(false)}
            className="group relative w-full py-4 px-6 rounded-xl bg-accent/15 hover:bg-accent/25 border border-accent/30 hover:border-accent/50 transition-all duration-300 overflow-hidden"
          >
            {/* Shimmer effect on hover */}
            <div
              className={`absolute inset-0 bg-gradient-to-r from-transparent via-accent/10 to-transparent transition-transform duration-700 ${isHovering ? "translate-x-full" : "-translate-x-full"}`}
            />

            <div className="relative flex items-center justify-center">
              <span
                className="relative text-sm font-medium text-accent transition-transform duration-300"
                style={{
                  transform: isHovering && !isLaunching ? "translateX(-6px)" : "translateX(0)",
                  transitionDuration: skipTransition.current ? "0ms" : "300ms",
                }}
              >
                Ready to launch
                <Rocket
                  className="absolute -right-8 top-0 w-4 h-4 text-accent/70 transition-all duration-300"
                  style={{
                    transform: isLaunching
                      ? "translate(16px, -16px)"
                      : isHovering
                        ? "translate(-3px, 3px)"
                        : "translate(-16px, 16px)",
                    opacity: isLaunching || !isHovering ? 0 : 1,
                    transitionDuration: skipTransition.current
                      ? "0ms"
                      : isLaunching
                        ? "400ms"
                        : "300ms",
                  }}
                />
              </span>
            </div>
          </button>

          <p className="text-center text-[11px] text-[#4b5563] mt-4">
            Import a project to get started
          </p>
        </div>

        {/* Keyboard hint */}
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[10px] text-[#4b5563] animate-fade-in"
          style={{ animationDelay: "1s" }}
        >
          <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] font-mono">
            ⌘
          </kbd>
          <span>+</span>
          <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] font-mono">
            O
          </kbd>
          <span className="ml-1">to open project</span>
        </div>
      </div>

      {/* CSS for animations */}
      <style>{`
        @keyframes draw-line {
          from {
            stroke-dashoffset: 300;
          }
          to {
            stroke-dashoffset: 0;
          }
        }

        @keyframes pulse-dot {
          0%, 100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.2);
          }
        }

        @keyframes float-particle {
          0%, 100% {
            transform: translateY(0) translateX(0);
            opacity: 0.3;
          }
          50% {
            transform: translateY(-20px) translateX(10px);
            opacity: 0.6;
          }
        }

        @keyframes fade-slide-up {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .animate-draw-line {
          stroke-dasharray: 300;
          stroke-dashoffset: 300;
          animation: draw-line 1.5s ease-out forwards;
        }

        .animate-pulse-dot {
          opacity: 0;
          animation: pulse-dot 3s ease-in-out infinite;
        }

        .animate-float-particle {
          animation: float-particle 4s ease-in-out infinite;
        }

        .animate-fade-slide-up {
          opacity: 0;
          animation: fade-slide-up 0.6s ease-out forwards;
        }

        .animate-fade-in {
          opacity: 0;
          animation: fade-in 0.6s ease-out forwards;
        }

      `}</style>
    </div>
  );
}
